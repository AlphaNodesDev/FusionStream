const popupQueue = [];
let isPopupShowing = false;

function showPopup({ message = 'No message', type = 'info' }) {
  popupQueue.push({ message, type });
  if (!isPopupShowing) {
    processNextPopup();
  }
}

function processNextPopup() {
  if (popupQueue.length === 0) {
    isPopupShowing = false;
    return;
  }

  isPopupShowing = true;

  const { message, type } = popupQueue.shift();
  const container = document.getElementById('popup-container');
  const div = document.createElement('div');
  div.className = `popup ${type}`;

  const iconMap = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
  };
  
  div.innerHTML = `
    <div class="popup-content">
      <span class="popup-icon">${iconMap[type] || 'ℹ️'}</span>
      <span class="popup-message">${message}</span>
    </div>
  `;
  

  container.appendChild(div);

  // Show popup
  setTimeout(() => div.classList.add('show'), 100);

  // Auto-hide and process next
  setTimeout(() => {
    div.classList.remove('show');
    setTimeout(() => {
      div.remove();
      processNextPopup(); // 🟢 Show next popup
    }, 300);
  }, 5000);
}

// EventSource for server-sent events
const eventSource = new EventSource('http://localhost:3000/events');

eventSource.onmessage = function (event) {
  try {
    const data = JSON.parse(event.data);
    showPopup(data); // Will queue instead of showing instantly
  } catch (e) {
    console.warn("Invalid message from server:", event.data);
  }
};
