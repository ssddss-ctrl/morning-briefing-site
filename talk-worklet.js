/* Copies microphone samples to the page so talk.js can stream them to Gemini Live. */
class TalkCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("talk-capture", TalkCapture);
