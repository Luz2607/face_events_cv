/* ui.js
   Funciones de UI: pintar overlay, actualizar contadores/estados,
   panel de umbrales en vivo y carga de datos vía fetch.
*/

// Dibuja puntos clave simples en el canvas
function drawLandmarks(ctx, landmarks, w, h) {
  // Si no hay landmarks, no dibuja nada
  if (!landmarks) return;
  ctx.save();
  ctx.fillStyle = "rgba(0, 255, 0, 0.8)";
  // Recorre los landmarks con muestreo (de 8 en 8) para no saturar el canvas
  for (let i = 0; i < landmarks.length; i += 8) { // muestreo para no saturar
    const x = landmarks[i].x * w; // convierte coordenada normalizada a px
    const y = landmarks[i].y * h; // convierte coordenada normalizada a px
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2); // dibuja un punto (radio 2)
    ctx.fill();
  }
  ctx.restore();
}

// Estados (badges)
// Actualiza las "chapas" de estado en la UI para ojo, boca y ceja
function updateStateBadges({ eyeIsClosed, mouthIsOpen, browIsRaised }) {
  const eyeState = document.getElementById("eyeState");
  const mouthState = document.getElementById("mouthState");
  const browState = document.getElementById("browState");

  // setBadge: asigna texto y color según estado (ok = resaltado)
  const setBadge = (el, text, ok) => {
    el.className = "badge";             // reinicia clases base
    el.textContent = text;              // pone el texto
    el.classList.add(ok ? "bg-warning"  // color si condición activa
                        : "bg-success"); // color si condición inactiva/normal
  };

  setBadge(eyeState, eyeIsClosed ? "Cerrado" : "Abierto", eyeIsClosed);
  setBadge(mouthState, mouthIsOpen ? "Abierta" : "Cerrada", mouthIsOpen);
  setBadge(browState, browIsRaised ? "Levantada" : "Normal", browIsRaised);
}

// Carga y muestra información del "programmer box" (perfil) en el aside/footer
async function loadProgrammerBox() {
  const box = document.getElementById("programmerBox");
  const footerName = document.getElementById("progName");
  const footerEmail = document.getElementById("progEmail");
  // Año dinámico en el footer
  document.getElementById("year").textContent = new Date().getFullYear();

  try {
    // Lee datos del programador desde JSON local
    const res = await fetch("assets/data/programmer.json");
    const data = await res.json();
    // Rellena el recuadro de perfil y el footer
box.innerHTML = `
  <div class="card shadow-sm border-0">
    <div class="card-body">
      <h5 class="card-title fw-bold text-dark">${data.name}</h5>
      <p class="card-text text-muted">${data.about}</p>
      <div class="d-flex gap-3 mt-2">
        </a>
      </div>
    </div>
  </div>
`;

    footerName.textContent = data.name;
    footerEmail.textContent = data.email;
  } catch {
    // Manejo simple de error de carga
    box.textContent = "No se pudieron cargar los datos del programador.";
  }
}

// Carga de umbrales desde archivo de configuración (JSON)
async function loadThresholds() {
  try {
    const res = await fetch("assets/config/thresholds.json");
    return await res.json(); // devuelve objeto de umbrales
  } catch {
    return null; // si falla, retorna null para que el caller decida fallback
  }
}

// Actualiza los contadores visibles en la UI (parpadeos, cejas, boca)
function updateCountersView({ blinks, browRaises, mouthOpens }) {
  document.getElementById("blinkCount").textContent = blinks;
  document.getElementById("browCount").textContent = browRaises;
  document.getElementById("mouthCount").textContent = mouthOpens;
}

// Muestra el bloque JSON de umbrales actual en un <pre> (para depuración/visualización)
function showThresholdsBox(th) {
  const pre = document.getElementById("thresholdsBox");
  pre.textContent = JSON.stringify(th, null, 2); // pretty-print
}

// ---------- Panel de umbrales en vivo ----------
// Rellena el formulario de umbrales con los valores actuales
function populateThresholdForm(th) {
  document.getElementById("EAR_close").value = th.EAR.close_threshold;
  document.getElementById("EAR_open").value = th.EAR.open_threshold;
  document.getElementById("MAR_open").value = th.MAR.open_threshold;
  document.getElementById("MAR_close").value = th.MAR.close_threshold;
  document.getElementById("BROW_raise").value = th.BROW.raise_threshold;
  document.getElementById("BROW_relax").value = th.BROW.relax_threshold;
}

// Lee los valores del formulario y construye un objeto de umbrales
function readThresholdForm() {
  const valNum = (id) => parseFloat(document.getElementById(id).value);
  return {
    EAR: {
      close_threshold: valNum("EAR_close"),
      open_threshold: valNum("EAR_open"),
      min_frames: 2 // frames mínimos para confirmar estado de ojos
    },
    MAR: {
      open_threshold: valNum("MAR_open"),
      close_threshold: valNum("MAR_close"),
      min_frames: 2 // frames mínimos para confirmar apertura/cierre de boca
    },
    BROW: {
      // Nota: en esta UI se manejan umbrales absolutos (legacy) para cejas
      raise_threshold: valNum("BROW_raise"),
      relax_threshold: valNum("BROW_relax"),
      min_frames: 3 // un poco más de inercia para cejas
    }
  };
}

// Guarda los umbrales "en vivo" en localStorage (persistencia local del navegador)
function saveThresholdsLocal(th) {
  localStorage.setItem("live_thresholds", JSON.stringify(th));
}

// Intenta cargar umbrales previos desde localStorage
function loadThresholdsLocal() {
  const raw = localStorage.getItem("live_thresholds");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; } // robustez ante JSON corrupto
}

// Exports para usar estas utilidades desde otros módulos
export {
  drawLandmarks,
  updateStateBadges,
  updateCountersView,
  loadProgrammerBox,
  loadThresholds,
  showThresholdsBox,
  populateThresholdForm,
  readThresholdForm,
  saveThresholdsLocal,
  loadThresholdsLocal
};
