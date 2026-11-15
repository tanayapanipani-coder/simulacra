// OpenAI's live voice connection from a browser: a WebRTC call. The microphone and the model's
// voice travel as real-time audio tracks (the browser handles echo cancellation and jitter), and
// the session's events travel over a data channel. This is the lowest-latency way to talk to it.
//
// `apiKey` is an OpenAI key, a short-lived pass from the relay (relay/worker.js), or a function
// returning (a promise of) either, called each time a call is started.
//
// `media.onMic(cb)` gives the microphone stream now or whenever it is switched on;
// `media.onVoice(stream|null)` receives the model's voice to play.
export function rtcConnector(apiKey, model, media) {
  return async ({ onMessage, onClose }) => {
    const pc = new RTCPeerConnection();
    // The microphone goes on the call as an ordinary track when it is already on (the usual case);
    // otherwise a send/receive slot is reserved and filled when the microphone is switched on.
    let sender = null;
    const stopMic = media.onMic((stream) => {
      const track = stream.getAudioTracks()[0];
      if (!track) return;
      if (sender) sender.replaceTrack(track);
      else sender = pc.addTrack(track, stream);
    });
    if (!sender) sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    const note = media.log || (() => {});
    pc.addEventListener('connectionstatechange', () => note('call ' + pc.connectionState));
    pc.ontrack = (e) => {
      note('voice track received');
      media.onVoice(e.streams[0] || new MediaStream([e.track]));
    };
    const events = pc.createDataChannel('oai-events');
    events.onmessage = (e) => onMessage(String(e.data));
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      stopMic();
      media.onVoice(null);
      try { pc.close(); } catch (e) { /* already closed */ }
      onClose();
    };
    try {
      await pc.setLocalDescription(await pc.createOffer());
      const res = await fetch('https://api.openai.com/v1/realtime/calls?model=' + encodeURIComponent(model), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + (typeof apiKey === 'function' ? await apiKey() : apiKey), 'Content-Type': 'application/sdp' },
        body: pc.localDescription.sdp,
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error('OpenAI refused the live connection (' + res.status + '): ' + (await res.text()).slice(0, 160));
      await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the live connection did not open within 8 s (this network may block it)')), 8000);
        events.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    } catch (e) {
      ended = true; // a failed start is reported by throwing, not by onClose
      stopMic();
      media.onVoice(null);
      try { pc.close(); } catch (e2) { /* never opened */ }
      throw e;
    }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') end(); };
    events.onclose = end;
    return { send: (text) => { if (events.readyState === 'open') events.send(text); }, close: end };
  };
}
