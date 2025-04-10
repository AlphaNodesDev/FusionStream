const popup = document.getElementById('popup');
const popupMessage = document.getElementById('popupMessage');

function showPopup({ message = 'No message', type = 'info' }) {
    const container = document.getElementById('popup-container');
    const div = document.createElement('div');
    div.className = `popup ${type}`;

    div.innerHTML = `
      <div class="popup-content">
        <span>${message}</span>
      </div>
    `;

    container.appendChild(div);

    // Show popup
    setTimeout(() => div.classList.add('show'), 100);

    // Auto-hide
    setTimeout(() => {
      div.classList.remove('show');
      setTimeout(() => div.remove(), 300);
    }, 5000);
  }

  const eventSource = new EventSource('http://localhost:3000/events'); // Change port if needed

  eventSource.onmessage = function (event) {
    try {
      const data = JSON.parse(event.data);
      showPopup(data);
    } catch (e) {
      console.warn("Invalid message from server:", event.data);
    }
  };