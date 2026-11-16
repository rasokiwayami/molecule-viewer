/** Shows the microphone button only where the browser can recognise speech. */
export function setupVoice(button, onText) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  let recognition;
  try {
    recognition = new Recognition();
  } catch {
    return;
  }
  recognition.lang = 'ja-JP';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  button.hidden = false;

  const setListening = (listening) => button.classList.toggle('listening', listening);
  recognition.onresult = (event) => {
    const heard = event.results?.[0]?.[0]?.transcript;
    if (heard) onText(heard.replace(/[。、.\s]+$/u, ''));
  };
  recognition.onend = () => setListening(false);
  recognition.onerror = (event) => {
    setListening(false);
    if (['not-allowed', 'service-not-allowed'].includes(event.error)) button.hidden = true;
  };
  button.addEventListener('click', () => {
    if (button.classList.contains('listening')) {
      recognition.stop();
      return;
    }
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  });
  window.addEventListener('pagehide', () => recognition.abort());
}
