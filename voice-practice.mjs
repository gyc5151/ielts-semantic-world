// All recording blobs stay in this browser session; only user metadata is saved.
let activeCleanup = () => {};
export function stopVoicePractice() { activeCleanup(); activeCleanup = () => {}; window.speechSynthesis?.cancel(); }
export function speakSentence(text, onStatus = () => {}, onComplete = () => {}) {
  if (!("speechSynthesis" in window) || !window.SpeechSynthesisUtterance) { onStatus("此浏览器没有可用的朗读功能，请使用文字练习。"); return; }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-GB";
  utterance.rate = 0.88;
  const voices = speechSynthesis.getVoices();
  utterance.voice = voices.find((v) => v.lang === "en-GB") || voices.find((v) => /^en[-_]/i.test(v.lang)) || null;
  utterance.onerror = () => onStatus("朗读未完成，可重试或继续文字练习。");
  utterance.onend = () => { onComplete(); onStatus("朗读结束。合成语音用于练习，不提供发音评分。"); };
  onStatus("正在朗读 · 浏览器合成语音");
  speechSynthesis.speak(utterance);
}
export function mountRecorder(host, onReady) {
  let stream, recorder, blobUrl, timer, cancelled = false, chunks = [], seconds = 0, recordingBlob = null;
  host.innerHTML = `<details class="oral-panel"><summary>先口头回答，再回听</summary><p>点击后请求麦克风权限。最多录两分钟，仅保留在本次页面会话；提交保存自评和录音时长。录音不会自动转写或判分。</p><div class="button-row"><button type="button" class="secondary-btn" data-record>开始录音</button><button type="button" class="secondary-btn" data-stop disabled>停止</button></div><p role="status" data-voice-status></p><audio controls data-recording hidden aria-label="回听自己的回答"></audio><button type="button" class="secondary-btn" data-use-recording hidden>用这次口头回答查看反馈</button></details>`;
  const start = host.querySelector("[data-record]"), stop = host.querySelector("[data-stop]"), use = host.querySelector("[data-use-recording]"), player = host.querySelector("audio"), status = host.querySelector("[data-voice-status]");
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { start.disabled = true; status.textContent = "此浏览器暂不能录音；你仍可自行口头回答并继续文字练习。"; }
  const release = () => { stream?.getTracks().forEach((t) => t.stop()); clearInterval(timer); };
  const cleanup = () => { cancelled = true; if (recorder?.state === "recording") recorder.stop(); release(); player.pause(); if (blobUrl) URL.revokeObjectURL(blobUrl); window.speechSynthesis?.cancel(); };
  activeCleanup = cleanup;
  start.addEventListener("click", async () => {
    start.disabled = true; use.hidden = true; player.hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (cancelled || !host.isConnected) { release(); return; }
      recorder = new MediaRecorder(stream); chunks = []; seconds = 0; recordingBlob = null;
      recorder.addEventListener("dataavailable", (e) => { if (e.data.size) chunks.push(e.data); });
      recorder.addEventListener("stop", () => {
        release();
        if (cancelled || !host.isConnected) return;
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        recordingBlob = blob;
        start.disabled = false; stop.disabled = true;
        if (!blob.size) { status.textContent = "没有录到音频，请重试。"; return; }
        blobUrl = URL.createObjectURL(blob); player.src = blobUrl; player.hidden = false; use.hidden = false;
        status.textContent = "录音结束，请回听后再提交；记录会标为口头自评。";
      });
      recorder.start(); stop.disabled = false;
      status.textContent = "正在录音 · 0秒";
      timer = setInterval(() => { seconds += 1; status.textContent = `正在录音 · ${seconds}秒`; if (seconds >= 120 && recorder.state === "recording") recorder.stop(); }, 1000);
    } catch (_) { release(); start.disabled = false; status.textContent = "无法打开麦克风，请检查权限，或继续文字练习。"; }
  });
  stop.addEventListener("click", () => { if (recorder?.state === "recording") recorder.stop(); });
  use.addEventListener("click", () => onReady({ durationSeconds: seconds, audioStored: false, blob: recordingBlob }));
  return cleanup;
}
