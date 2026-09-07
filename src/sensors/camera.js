// Rear-camera pass-through for AR mode. Needs HTTPS (or localhost) and a user tap on iOS.
export async function startCamera(videoEl) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera is not available in this browser (needs HTTPS).");
  const constraints = { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream; videoEl.hidden = false;
  await videoEl.play().catch(() => {});
  const track = stream.getVideoTracks()[0];
  const st = track.getSettings?.() ?? {};
  return { stream, width: st.width, height: st.height, label: track.label };
}
export function stopCamera(videoEl) {
  const s = videoEl.srcObject; if (s) for (const t of s.getTracks()) t.stop();
  videoEl.srcObject = null; videoEl.hidden = true;
}
