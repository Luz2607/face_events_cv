// assets/js/app.js
import { ExpressionCounters } from "./counters.js";
import {
  drawLandmarks,
  updateStateBadges,
  loadProgrammerBox,
  loadThresholds
} from "./ui.js";
// >>> Telemetría a MockAPI (agregado, no bloquea nada)
import { MockApi } from "./telemetry.js";

// Elementos base
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");

// Botones UI
const btnStart = document.getElementById("btnStart");
const btnStop  = document.getElementById("btnStop");
const btnReset = document.getElementById("btnReset");

// Estado de la app
let counters = null;
let faceMesh = null;
let camera = null;
let latestLandmarks = null;
let stream = null;
let camActive = false;

// Animación visual de los contadores
function animateCounter(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("updated");
  setTimeout(() => el.classList.remove("updated"), 280);
}

// Resultados de MediaPipe FaceMesh
function onResults(results) {
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    latestLandmarks = results.multiFaceLandmarks[0].map(p => ({
      x: p.x, y: p.y, z: p.z || 0
    }));
  } else {
    latestLandmarks = null;
  }
}

// Iniciar cámara + FaceMesh bajo demanda (click)
async function startCamera() {
  if (camActive) return;

  try {
    // Solicitar cámara
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: false
    });
    video.srcObject = stream;
    await video.play();

    // Dimensionar canvas
    overlay.width  = video.videoWidth  || 640;
    overlay.height = video.videoHeight || 480;

    // Ocultamos el <video>, pintamos todo en canvas
    video.classList.add("d-none");

    // Instanciar FaceMesh (global de MediaPipe)
    faceMesh = new FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });
    faceMesh.onResults(onResults);

    // Cámara virtual de MediaPipe (lee del <video>)
    camera = new Camera(video, {
      onFrame: async () => {
        try {
          await faceMesh.send({ image: video });
        } catch (e) {
          // Evita que un frame con fallo rompa el bucle
          // (p.ej. cuando se detiene el stream)
        }
      },
      width:  overlay.width,
      height: overlay.height
    });

    camera.start();
    camActive = true;

    // Estado de botones
    if (btnStart) btnStart.disabled = true;
    if (btnStop)  btnStop.disabled  = false;

    // Arrancar loop de render
    renderLoop();
  } catch (err) {
    console.error("[cam] Error al iniciar cámara:", err);
    alert("No se pudo acceder a la cámara. Revisa permisos, que otra app no la esté usando y que estás en http://localhost o HTTPS.");
  }
}

// Detener cámara y limpiar
function stopCamera() {
  if (!camActive) return;

  try {
    // Detener cámara de MediaPipe
    if (camera) {
      camera.stop();
      camera = null;
    }
    // Parar tracks del stream
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
  } finally {
    camActive = false;
    latestLandmarks = null;

    // Limpiar canvas
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // Opcional: resetear badges de estado visual
    updateStateBadges({ eyeIsClosed: false, mouthIsOpen: false, browIsRaised: false });

    // Estado de botones
    if (btnStart) btnStart.disabled = false;
    if (btnStop)  btnStop.disabled  = true;

    console.log("[cam] Cámara detenida.");
  }
}

// Bucle de renderizado
function renderLoop() {
  if (!camActive) return; // se corta si se detuvo

  // Pintar frame actual
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.drawImage(video, 0, 0, overlay.width, overlay.height);

  if (latestLandmarks && counters) {
    // Actualizar contadores y obtener métricas (EAR, MAR, BROW)
    const metrics = counters.update(latestLandmarks);

    // Dibujar landmarks (puntos) sobre el rostro
    drawLandmarks(ctx, latestLandmarks, overlay.width, overlay.height);

    // Actualizar estados (badges)
    updateStateBadges({
      eyeIsClosed: counters.eyeIsClosed,
      mouthIsOpen: counters.mouthIsOpen,
      browIsRaised: counters.browIsRaised
    });

    // Actualizar contadores con animación
    const blinkEl = document.getElementById("blinkCount");
    const browEl  = document.getElementById("browCount");
    const mouthEl = document.getElementById("mouthCount");

    if (blinkEl && blinkEl.textContent !== String(counters.blinks)) {
      blinkEl.textContent = counters.blinks;
      animateCounter("blinkCount");
    }
    if (browEl && browEl.textContent !== String(counters.browRaises)) {
      browEl.textContent = counters.browRaises;
      animateCounter("browCount");
    }
    if (mouthEl && mouthEl.textContent !== String(counters.mouthOpens)) {
      mouthEl.textContent = counters.mouthOpens;
      animateCounter("mouthCount");
    }

    // >>> Envío a MockAPI (solo cuando cambian los contadores; no bloquea render)
    MockApi.reportCounters({
      blinks: counters.blinks,
      browRaises: counters.browRaises,
      mouthOpens: counters.mouthOpens
    });

    // ----------- DEBUG en pantalla: EAR / MAR / BROW -----------
    if (metrics) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(10, 10, 220, 80);
      ctx.fillStyle = "#00FF7F";
      ctx.font = "12px monospace";
      ctx.fillText(`EAR:  ${metrics.ear.toFixed(3)}`, 20, 30);
      ctx.fillText(`MAR:  ${metrics.mar.toFixed(3)}`, 20, 45);
      ctx.fillText(`BROW: ${metrics.brow.toFixed(3)}`, 20, 60);
    }
    // -----------------------------------------------------------
  }

  requestAnimationFrame(renderLoop);
}

// Inicialización principal
async function main() {
  // Info de programador en el footer
  await loadProgrammerBox();

  // Umbrales desde thresholds.json
  const th = await loadThresholds();
  if (!th) {
    alert("No se pudieron cargar los umbrales (assets/config/thresholds.json).");
    return;
  }
  counters = new ExpressionCounters(th);

  // Enlaces de botones
  if (btnStart) btnStart.addEventListener("click", startCamera);
  if (btnStop)  btnStop.addEventListener("click",  stopCamera);
  if (btnReset) btnReset.addEventListener("click", () => {
    if (!counters) return;
    counters.blinks = 0;
    counters.browRaises = 0;
    counters.mouthOpens = 0;
    const blinkEl = document.getElementById("blinkCount");
    const browEl  = document.getElementById("browCount");
    const mouthEl = document.getElementById("mouthCount");
    if (blinkEl) blinkEl.textContent = "0";
    if (browEl)  browEl.textContent  = "0";
    if (mouthEl) mouthEl.textContent = "0";
    animateCounter("blinkCount");
    animateCounter("browCount");
    animateCounter("mouthCount");
  });

  // Recomendación de seguridad para getUserMedia
  const isSecure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!isSecure) {
    console.warn("[ctx] La cámara requiere HTTPS o http://localhost.");
  }
}

document.addEventListener("DOMContentLoaded", main);
