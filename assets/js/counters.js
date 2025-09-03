/* assets/js/counters.js
   Detección y conteo:
   - Ojos (EAR) -> parpadeos
   - Boca (MAR) -> aperturas de boca
   - Cejas (BROW) -> levantamiento (flanco de subida) con baseline + EMA + histéresis
*/

const FaceMetrics = (() => {
  // Distancia euclidiana entre dos puntos (x,y)
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // EAR: índices de landmarks para ojos (esquema tipo MediaPipe/FaceMesh, similar a dlib)
  const eyeIdxL = [33, 160, 158, 133, 153, 144];
  const eyeIdxR = [263, 387, 385, 362, 380, 373];

  /**
   * Calcula EAR (Eye Aspect Ratio) para un ojo.
   * Valor bajo -> ojo cerrado; valor alto -> ojo abierto.
   * EAR = (A + B) / (2*C) donde:
   *  - A = distancia vertical 1
   *  - B = distancia vertical 2
   *  - C = distancia horizontal (ancho del ojo)
   */
  function eyeAspectRatio(landmarks, left = true) {
    const idx = left ? eyeIdxL : eyeIdxR;
    const p1 = landmarks[idx[0]], p2 = landmarks[idx[1]],
          p3 = landmarks[idx[2]], p4 = landmarks[idx[3]],
          p5 = landmarks[idx[4]], p6 = landmarks[idx[5]];
    const A = dist(p2, p6);
    const B = dist(p3, p5);
    const C = dist(p1, p4);
    return (A + B) / (2.0 * C);
  }

  /**
   * MAR (Mouth Aspect Ratio): relación alto/ancho de la boca.
   * Valor alto -> boca abierta; valor bajo -> boca cerrada.
   */
  function mouthAspectRatio(landmarks) {
    const left = landmarks[61];
    const right = landmarks[291];
    const top = landmarks[13];
    const bottom = landmarks[14];
    const vertical = dist(top, bottom);
    const horizontal = dist(left, right);
    return vertical / horizontal;
  }

  /**
   * Centro y ancho del ojo (outer-inner) para normalizar métricas de cejas respecto al tamaño del ojo.
   * Devuelve el centro (promedio) y el ancho (distancia) del ojo.
   */
  function eyeCenterAndWidth(landmarks, left = true) {
    const outer = left ? landmarks[33]  : landmarks[263];
    const inner = left ? landmarks[133] : landmarks[362];
    const center = { x: (outer.x + inner.x) / 2, y: (outer.y + inner.y) / 2 };
    const width = dist(outer, inner);
    return { center, width: Math.max(width, 1e-6) }; // evita división por cero
  }

  /**
   * browRatioRaw: métrica cruda de cejas normalizada por el ancho del ojo correspondiente.
   * Mayor valor -> cejas más arriba (en MediaPipe, y menor es más arriba).
   * Se promedia ceja izq/der para una sola métrica.
   */
  function browRatioRaw(landmarks) {
    const browLeftY  = (landmarks[70].y  + landmarks[63].y  + landmarks[105].y) / 3;
    const browRightY = (landmarks[336].y + landmarks[296].y + landmarks[334].y) / 3;

    const { center: eyeLC, width: eyeLW } = eyeCenterAndWidth(landmarks, true);
    const { center: eyeRC, width: eyeRW } = eyeCenterAndWidth(landmarks, false);

    // En MediaPipe, y menor = más arriba. Distancia ceja-ojo: ojo.y - ceja.y
    const leftNorm  = (eyeLC.y - browLeftY)  / eyeLW;
    const rightNorm = (eyeRC.y - browRightY) / eyeRW;

    return (leftNorm + rightNorm) / 2;
  }

  // Exponemos utilidades de métricas faciales
  return { eyeAspectRatio, mouthAspectRatio, browRatioRaw };
})();

class ExpressionCounters {
  /**
   * th = thresholds (umbrales), estructura esperada:
   * {
   *   EAR: { close_threshold, open_threshold, min_frames },
   *   MAR: { open_threshold, close_threshold, min_frames },
   *   BROW: { raise_threshold_pct, relax_threshold_pct, min_frames } // o absolutos legacy
   * }
   */
  constructor(th) {
    this.th = structuredClone(th); // copia defensiva de umbrales

    // Contadores de eventos detectados
    this.blinks = 0;      // parpadeos
    this.mouthOpens = 0;  // aperturas de boca
    this.browRaises = 0;  // levantamientos de ceja (solo flanco de subida)

    // Estados y acumuladores de frames para ojos/boca (histéresis temporal)
    this.eyeClosedFrames = 0;
    this.eyeOpenFrames = 0;
    this.mouthOpenFrames = 0;
    this.mouthClosedFrames = 0;

    this.eyeIsClosed = false;
    this.mouthIsOpen = false;

    // ---- Cejas: baseline + EMA + histéresis + flanco de subida ----
    this.browIsRaised = false; // estado actual de ceja (arriba/abajo)
    this.browUpFrames = 0;     // frames consecutivos por encima de raise
    this.browRelaxFrames = 0;  // frames consecutivos por debajo de relax
    this.browReady = true;     // armado para contar una nueva subida

    // Calibración y suavizado de cejas
    this._browEMA = null;         // valor suavizado (EMA) de cejas
    this._browBaseline = null;    // línea base (rostro neutro)
    this._browCalibFrames = 0;    // frames usados para calibrar baseline
    this._browCalibNeeded = 25;   // frames requeridos para baseline (~0.8s a ~30fps)
    this._emaAlpha = 0.30;        // factor de suavizado (más alto = más sensible)
  }

  // Permite actualizar umbrales en caliente
  setThresholds(newTh) {
    this.th = structuredClone(newTh);
  }

  // Resetea contadores, estados y calibración (sin tocar this.th)
  reset() {
    this.blinks = 0;
    this.mouthOpens = 0;
    this.browRaises = 0;

    this.eyeClosedFrames = 0;
    this.eyeOpenFrames = 0;
    this.mouthOpenFrames = 0;
    this.mouthClosedFrames = 0;

    this.eyeIsClosed = false;
    this.mouthIsOpen = false;

    this.browIsRaised = false;
    this.browUpFrames = 0;
    this.browRelaxFrames = 0;
    this.browReady = true;

    this._browEMA = null;
    this._browBaseline = null;
    this._browCalibFrames = 0;
  }

  /**
   * Obtiene umbrales efectivos para BROW:
   * - Si vienen como porcentaje (recomendado), los usa directo.
   * - Si vienen absolutos (legacy) y ya hay baseline, los convierte a porcentaje relativo.
   * - Si no, usa valores por defecto sensibles.
   */
  _getBrowThresholds() {
    const B = this.th.BROW || {};
    const minF = B.min_frames ?? 2; // frames consecutivos mínimos
    if (typeof B.raise_threshold_pct === "number" && typeof B.relax_threshold_pct === "number") {
      return { raise: B.raise_threshold_pct, relax: B.relax_threshold_pct, minF };
    }
    if (typeof B.raise_threshold === "number" && typeof B.relax_threshold === "number" && this._browBaseline) {
      const raisePct = (B.raise_threshold - this._browBaseline) / this._browBaseline;
      const relaxPct = (B.relax_threshold - this._browBaseline) / this._browBaseline;
      return { raise: raisePct, relax: relaxPct, minF };
    }
    // Fallback sensible si no hay config válida
    return { raise: 0.08, relax: 0.04, minF };
  }

  /**
   * update(landmarks): procesa un frame de landmarks (>=468 puntos),
   * actualiza contadores/estados y retorna métricas instantáneas para HUD:
   * { ear, mar, brow } donde brow es delta porcentual vs baseline.
   */
  update(landmarks) {
    if (!landmarks || landmarks.length < 468) return;

    // ================== OJOS (EAR) ==================
    const earL = FaceMetrics.eyeAspectRatio(landmarks, true);
    const earR = FaceMetrics.eyeAspectRatio(landmarks, false);
    const ear = (earL + earR) / 2;

    // Histéresis por frames: cerrar
    if (ear < this.th.EAR.close_threshold) {
      this.eyeClosedFrames++;
      this.eyeOpenFrames = 0;
      if (!this.eyeIsClosed && this.eyeClosedFrames >= this.th.EAR.min_frames) {
        this.eyeIsClosed = true; // estado: cerrado confirmado
      }
    // Histéresis por frames: abrir y contar parpadeo al pasar de cerrado -> abierto
    } else if (ear > this.th.EAR.open_threshold) {
      this.eyeOpenFrames++;
      if (this.eyeIsClosed && this.eyeOpenFrames >= this.th.EAR.min_frames) {
        this.blinks++;             // parpadeo contado
        this.eyeIsClosed = false;  // estado: abierto confirmado
        this.eyeClosedFrames = 0;  // reset acumulador opuesto
      }
    }

    // ================== BOCA (MAR) ==================
    const mar = FaceMetrics.mouthAspectRatio(landmarks);

    // Detecta apertura sostenida
    if (mar > this.th.MAR.open_threshold) {
      this.mouthOpenFrames++;
      this.mouthClosedFrames = 0;
      if (!this.mouthIsOpen && this.mouthOpenFrames >= this.th.MAR.min_frames) {
        this.mouthIsOpen = true; // estado: abierta
      }
    // Detecta cierre sostenido y cuenta un evento de "apertura" completo
    } else if (mar < this.th.MAR.close_threshold) {
      this.mouthClosedFrames++;
      if (this.mouthIsOpen && this.mouthClosedFrames >= this.th.MAR.min_frames) {
        this.mouthOpens++;         // cuenta ciclo de apertura-cierre
        this.mouthIsOpen = false;  // estado: cerrada
        this.mouthOpenFrames = 0;  // reset acumulador opuesto
      }
    }

    // ================== CEJAS (BROW) ==================
    const browRaw = FaceMetrics.browRatioRaw(landmarks);

    // EMA (suavizado exponencial) para reducir ruido
    this._browEMA = (this._browEMA === null)
      ? browRaw
      : (this._emaAlpha * browRaw + (1 - this._emaAlpha) * this._browEMA);

    // Calibración de baseline (rostro neutro) durante N frames
    if (this._browBaseline === null && this._browCalibFrames < this._browCalibNeeded) {
      const n = this._browCalibFrames;
      this._browBaseline = (this._browBaseline === null)
        ? this._browEMA
        : ((this._browBaseline * n + this._browEMA) / (n + 1)); // media incremental
      this._browCalibFrames++;
      // Mientras calibra, devolvemos brow 0 (no hay delta)
      return { ear, mar, brow: 0 };
    } else if (this._browBaseline === null) {
      // Seguridad: si no se alcanzó el mínimo, fija baseline con EMA actual
      this._browBaseline = this._browEMA;
    }

    // Delta porcentual relativo a baseline: (EMA - baseline) / baseline
    const browDeltaPct = (this._browEMA - this._browBaseline) / this._browBaseline;

    // Umbrales efectivos (porcentaje) e histéresis temporal
    const { raise, relax, minF } = this._getBrowThresholds();

    /*
      Lógica de flanco de subida para contar levantamiento de cejas:
      - Cuenta SOLO cuando cruza hacia arriba (browDeltaPct > raise) por minF frames y browReady=true.
      - Al bajar por debajo de relax por minF frames, se "arma" de nuevo (browReady=true)
        para permitir la siguiente detección de subida.
    */
    if (browDeltaPct > raise) {
      this.browUpFrames++;
      this.browRelaxFrames = 0;

      if (!this.browIsRaised && this.browUpFrames >= minF) {
        this.browIsRaised = true;

        if (this.browReady) {
          this.browRaises++;      // cuenta SOLO la subida (no el descenso)
          this.browReady = false; // desarma hasta que se relaje
        }
      }
    } else if (browDeltaPct < relax) {
      this.browRelaxFrames++;
      this.browUpFrames = 0;

      if (this.browIsRaised && this.browRelaxFrames >= minF) {
        this.browIsRaised = false;
        this.browReady = true;    // listo para la próxima subida
      }
    } else {
      // Zona muerta: entre raise y relax; evita rebotes
      this.browUpFrames = 0;
      this.browRelaxFrames = 0;
    }

    // Retorna métricas instantáneas para mostrar en HUD/overlay
    return { ear, mar, brow: browDeltaPct };
  }
}

// Exporta la clase de contadores y las utilidades de métricas
export { ExpressionCounters, FaceMetrics };
