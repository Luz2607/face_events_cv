// assets/js/telemetry.js
// Envío de métricas a MockAPI sin saturar la red (1 request por cambio)

const MockApi = (() => {
  const ENDPOINT = "https://68b8996bb71540504328aabb.mockapi.io/api/v1/gestos";

  // Últimos valores enviados (para detectar cambios)
  let last = { blinks: 0, browRaises: 0, mouthOpens: 0 };

  // bandera para evitar doble envío si hay múltiples cambios en el mismo frame
  let sending = false;

  // Normaliza payload al esquema de MockAPI
  function buildPayload({ blinks, browRaises, mouthOpens }) {
    return {
      parpadeo: Number(blinks),
      cejas: Number(browRaises),
      boca: Number(mouthOpens),
      fecha_hora: new Date().toISOString()
    };
  }

  async function send(payload) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        // Log mínimo para no ensuciar consola en producción
        console.warn("[MockAPI] Error HTTP:", res.status, await res.text());
      }
    } catch (err) {
      console.warn("[MockAPI] Error de red:", err?.message || err);
    }
  }

  /**
   * reportCounters: llama esto DESPUÉS de actualizar contadores/DOM.
   * Envía un POST SOLO si algún contador cambió vs el último enviado.
   */
  async function reportCounters({ blinks, browRaises, mouthOpens }) {
    // Cambió algo respecto al último payload enviado?
    const changed =
      blinks !== last.blinks ||
      browRaises !== last.browRaises ||
      mouthOpens !== last.mouthOpens;

    if (!changed || sending) return;

    sending = true;
    const payload = buildPayload({ blinks, browRaises, mouthOpens });
    await send(payload);
    last = { blinks, browRaises, mouthOpens };
    sending = false;
  }

  return { reportCounters };
})();

export { MockApi };
