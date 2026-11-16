// Mobile browsers often never mark a result as final, so a pause in speech ends the input.
const SILENCE_MS = 1300;
const MAX_LISTEN_MS = 8000;

/**
 * Shows the microphone button only where the browser can recognise speech.
 * onListening(boolean), onInterim(text) while speaking, onFinal(text) once per utterance,
 * onError(reason) with 'denied' | 'no-speech' | 'failed'.
 */
export function setupVoice(button, { onListening, onInterim, onFinal, onError }) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  let recognition;
  try {
    recognition = new Recognition();
  } catch {
    return;
  }
  recognition.lang = 'ja-JP';
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  button.hidden = false;

  let listening = false;
  let heard = '';
  let failed = false;
  let silenceTimer = 0;
  let limitTimer = 0;

  function setListening(next) {
    listening = next;
    button.classList.toggle('listening', next);
    onListening(next);
  }

  function stop() {
    try {
      recognition.stop();
    } catch {
      // Already stopped.
    }
  }

  recognition.onresult = (event) => {
    heard = Array.from(event.results, (result) => result[0].transcript)
      .join('')
      .replace(/[。、.\s]+$/u, '');
    if (!heard) return;
    onInterim(heard);
    clearTimeout(silenceTimer);
    const final = event.results[event.results.length - 1].isFinal;
    if (final) stop();
    else silenceTimer = setTimeout(stop, SILENCE_MS);
  };

  recognition.onerror = (event) => {
    if (event.error === 'aborted') return;
    failed = true;
    const denied = ['not-allowed', 'service-not-allowed'].includes(event.error);
    onError(denied ? 'denied' : event.error === 'no-speech' ? 'no-speech' : 'failed');
  };

  recognition.onend = () => {
    clearTimeout(silenceTimer);
    clearTimeout(limitTimer);
    setListening(false);
    if (heard) onFinal(heard);
    else if (!failed) onError('no-speech');
  };

  button.addEventListener('click', () => {
    if (listening) {
      stop();
      return;
    }
    heard = '';
    failed = false;
    try {
      recognition.start();
    } catch {
      onError('failed');
      return;
    }
    setListening(true);
    limitTimer = setTimeout(stop, MAX_LISTEN_MS);
  });
  window.addEventListener('pagehide', () => recognition.abort());
}
