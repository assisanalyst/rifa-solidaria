const API_URL = "https://script.google.com/macros/s/AKfycbz9iEzI4JjS_48GZnqzfLS8fRTF8Jd4tVp8R21sMkhp4ethO5c5c89Kl9f9iUmWk57T/exec";
let selectedNumbers = [];

document.addEventListener("DOMContentLoaded", () => {
  loadRaffleData();
});

async function loadRaffleData() {
  const res = await fetch(`${API_URL}?action=getPublicData`);
  const data = await res.json();
  
  if (!data.success) return alert("Erro ao carregar dados.");

  document.getElementById("raffle-title").innerText = data.config.raffle_name;
  document.getElementById("ticket-price").innerText = parseFloat(data.config.ticket_price).toFixed(2);
  
  const grid = document.getElementById("numbers-grid");
  grid.innerHTML = "";
  
  data.numbers.forEach(item => {
    const btn = document.createElement("button");
    btn.className = `num-btn ${item.status.toLowerCase()}`;
    btn.innerText = item.number;
    
    if (item.status === "AVAILABLE") {
      btn.onclick = () => toggleSelect(btn, item.number);
    }
    grid.appendChild(btn);
  });
}

function toggleSelect(btn, num) {
  if (selectedNumbers.includes(num)) {
    selectedNumbers = selectedNumbers.filter(n => n !== num);
    btn.classList.remove("selected");
  } else {
    selectedNumbers.push(num);
    btn.classList.add("selected");
  }
  document.getElementById("selected-count").innerText = selectedNumbers.length;
}

async function submitReservation() {
  const name = document.getElementById("cust-name").value;
  const whatsapp = document.getElementById("cust-phone").value;
  
  if (!name || !whatsapp) return alert("Preencha nome e WhatsApp.");
  if (selectedNumbers.length === 0) return alert("Selecione ao menos 1 número.");

  const payload = {
    action: "createReservation",
    name: name,
    whatsapp: whatsapp,
    numbers: selectedNumbers
  };

  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  
  const data = await res.json();
  
  if (data.success) {
    document.getElementById("step-selection").style.display = "none";
    document.getElementById("step-pix").style.display = "block";
    
    document.getElementById("pix-key").innerText = data.order.pix_key;
    document.getElementById("pix-receiver").innerText = data.order.pix_receiver;
    document.getElementById("pix-total").innerText = parseFloat(data.order.total_amount).toFixed(2);
    window.currentOrderId = data.order.order_id;
  } else {
    alert(data.error);
    loadRaffleData();
  }
}

async function reportPayment() {
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "reportPayment", order_id: window.currentOrderId })
  });
  const data = await res.json();
  if (data.success) {
    alert("Pagamento informado com sucesso! Aguarde a confirmação.");
    location.reload();
  }
}

// PAINEL ADMIN SIMPLIFICADO
async function loginAdmin() {
  const token = prompt("Digite o Token Administrativo:");
  if (!token) return;
  
  const res = await fetch(`${API_URL}?action=adminGetOrders&token=${token}`);
  const data = await res.json();
  
  if (!data.success) return alert("Token inválido.");

  let html = "<h2>Painel de Pedidos</h2>";
  data.orders.forEach(o => {
    html += `<div style="border-bottom:1px solid #ccc; padding:10px 0;">
      <b>Pedido:</b> ${o.order_id} | <b>Nome:</b> ${o.name} | <b>Status:</b> ${o.status}<br>
      <b>Números:</b> ${o.numbers} | <b>Total:</b> R$ ${parseFloat(o.total_amount).toFixed(2)}<br>`;
      if (o.status !== "PAID") {
        html += `<button onclick="confirmPay('${o.order_id}', '${token}')">Confirmar Pagamento</button>`;
      }
    html += `</div>`;
  });
  
  document.body.innerHTML = `<div class="container">${html}<br><button onclick="location.reload()">Voltar ao Site</button></div>`;
}

async function confirmPay(orderId, token) {
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminConfirmPayment", order_id: orderId, token: token })
  });
  const data = await res.json();
  if (data.success) {
    alert("Pagamento confirmado!");
    loginAdmin();
  }
}