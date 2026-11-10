const API_URL = "https://script.google.com/macros/s/AKfycbyKspzEjiGUwr6uIclzVZTBT-ZQYVJV6D6PYJqVcdIsGWLG4XRDAd93PnZ52VnBfQFPNA/exec"; // Mantenha a sua URL do Google Apps Script aqui
let selectedNumbers = [];
let ticketPrice = 15.00;
let cachedNumbersData = [];
let adminTokenCache = "";

document.addEventListener("DOMContentLoaded", () => {
  loadRaffleData();
});

async function loadRaffleData() {
  try {
    const res = await fetch(`${API_URL}?action=getPublicData`);
    const data = await res.json();
    
    if (!data.success) {
      alert("Erro ao carregar dados.");
      return;
    }

    document.getElementById("raffle-title").innerText = data.config.raffle_name || "Rifa Solidária";
    ticketPrice = parseFloat(data.config.ticket_price || 15.00);
    document.getElementById("ticket-price").innerText = ticketPrice.toFixed(2);
    cachedNumbersData = data.numbers;
    
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
    updateSummary();
  } catch (e) {
    console.error(e);
    alert("Falha de conexão.");
  }
}

function toggleSelect(btn, num) {
  if (selectedNumbers.includes(num)) {
    selectedNumbers = selectedNumbers.filter(n => n !== num);
    btn.classList.remove("selected");
  } else {
    selectedNumbers.push(num);
    btn.classList.add("selected");
  }
  updateSummary();
}

function updateSummary() {
  document.getElementById("selected-count").innerText = selectedNumbers.length;
  const total = selectedNumbers.length * ticketPrice;
  document.getElementById("selected-total").innerText = total.toFixed(2);
}

async function submitReservation() {
  const name = document.getElementById("cust-name").value.trim();
  const whatsapp = document.getElementById("cust-phone").value.trim();
  
  if (!name || !whatsapp) {
    alert("Por favor, preencha seu Nome e WhatsApp.");
    return;
  }
  if (selectedNumbers.length === 0) {
    alert("Selecione ao menos 1 número.");
    return;
  }

  const btnSubmit = document.getElementById("btn-reserve");
  btnSubmit.innerText = "Reservando...";
  btnSubmit.disabled = true;

  try {
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
      
      document.getElementById("pix-key").innerText = data.order.pix_key || "Chave não configurada";
      document.getElementById("pix-receiver").innerText = data.order.pix_receiver || "Organizador";
      document.getElementById("pix-bank").innerText = data.order.pix_bank || "Banco Oficial";
      document.getElementById("pix-total").innerText = parseFloat(data.order.total_amount).toFixed(2);
      document.getElementById("pix-numbers").innerText = selectedNumbers.join(", ");
      window.currentOrderId = data.order.order_id;
    } else {
      alert(data.error || "Erro ao reservar.");
      btnSubmit.innerText = "Garantir Meus Números";
      btnSubmit.disabled = false;
      loadRaffleData();
    }
  } catch (err) {
    alert("Erro de conexão.");
    btnSubmit.innerText = "Garantir Meus Números";
    btnSubmit.disabled = false;
  }
}

// FUNÇÃO DE TOQUE PARA COPIAR A CHAVE PIX NO CELULAR
function copyPixKey() {
  const pixKeyText = document.getElementById("pix-key").innerText;
  if (!pixKeyText || pixKeyText === "Chave não configurada") return;

  // Tenta o método moderno primeiro
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(pixKeyText).then(() => {
      showCopyFeedback();
    }).catch(() => {
      // Se falhar, usa o método alternativo de input oculto
      fallbackCopyText(pixKeyText);
    });
  } else {
    // Para navegadores mais antigos que não suportam clipboard API
    fallbackCopyText(pixKeyText);
  }
}

// Método alternativo infalível para telemóveis restritos
function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  
  // Posiciona fora da tela para evitar scroll automático no telemóvel
  textArea.style.position = "fixed";
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.opacity = "0";
  
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showCopyFeedback();
    } else {
      alert("Chave Pix: " + text);
    }
  } catch (err) {
    alert("Chave Pix: " + text);
  }

  document.body.removeChild(textArea);
}

// Exibe o aviso verde de sucesso
function showCopyFeedback() {
  const feedback = document.getElementById("copy-feedback");
  if (feedback) {
    feedback.style.display = "block";
    setTimeout(() => {
      feedback.style.display = "none";
    }, 2500);
  } else {
    alert("Chave Pix copiada com sucesso!");
  }
}

async function reportPayment() {
  if (!window.currentOrderId) {
    alert("ID do pedido não encontrado.");
    return;
  }
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      body: JSON.stringify({ action: "reportPayment", order_id: window.currentOrderId })
    });
    const data = await res.json();
    if (data.success) {
      alert("Pagamento informado com sucesso! O organizador irá conferir em breve.");
      location.reload();
    } else {
      alert("Erro ao reportar: " + (data.error || "Tente novamente"));
    }
  } catch(e) {
    alert("Erro de conexão ao reportar pagamento.");
  }
}

async function loginAdmin() {
  if (!adminTokenCache) {
    const token = prompt("Digite a senha de acesso administrativo:");
    if (!token) return;
    adminTokenCache = token.trim();
  }
  
  try {
    const res = await fetch(`${API_URL}?action=adminGetOrders&token=${encodeURIComponent(adminTokenCache)}`);
    const data = await res.json();
    
    if (!data.success) {
      adminTokenCache = "";
      alert(data.error || "Senha incorreta.");
      return;
    }

    let html = `<h2>Painel do Organizador</h2>
      <p style="font-size:12px; color:#64748b; text-align:center;">Gerenciamento Geral da Rifa</p>
      
      <button onclick="generateRaffleImage()" style="background:#4f46e5; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; margin: 12px 0;">📱 Gerar Mapa de Status para WhatsApp</button>
      <hr style="border:0; border-top:1px solid #e2e8f0; margin:12px 0;">`;
    
    if (data.orders.length === 0) {
      html += `<p style="text-align:center; color:#64748b;">Nenhum pedido registrado até o momento.</p>`;
    }

    data.orders.forEach(o => {
      let statusColor = "#f59e0b";
      if (o.status === "PAID") statusColor = "#059669";
      if (o.status === "PAYMENT_REPORTED") statusColor = "#2563eb";
      if (o.status === "CANCELLED") statusColor = "#dc2626";

      html += `<div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:10px; margin-bottom:12px; font-size:13px;">
        <b>Pedido:</b> ${o.order_id} <br>
        <b>Nome:</b> ${o.name} (${o.whatsapp})<br>
        <b>Números:</b> <span style="color:#2563eb; font-weight:bold;">${o.numbers}</span><br>
        <b>Total:</b> R$ ${parseFloat(o.total_amount).toFixed(2)}<br>
        <b>Status:</b> <span style="color:${statusColor}; font-weight:bold;">${o.status}</span><br><br>`;
        
        if (o.status !== "PAID" && o.status !== "CANCELLED") {
          html += `<button onclick="confirmPay('${o.order_id}')" style="background:#059669; color:white; border:none; padding:8px; border-radius:6px; font-weight:bold; cursor:pointer; width:100%; margin-bottom:6px;">Confirmar Pagamento</button>`;
        }
        if (o.status !== "CANCELLED") {
          html += `<button onclick="cancelOrderAction('${o.order_id}')" style="background:#dc2626; color:white; border:none; padding:8px; border-radius:6px; font-weight:bold; cursor:pointer; width:100%;">Cancelar e Liberar Números</button>`;
        }
      html += `</div>`;
    });
    
    html += `<br><button onclick="resetDatabaseAction()" style="background:#1e293b; color:white; border:none; padding:10px; border-radius:8px; font-weight:bold; cursor:pointer; width:100%; margin-bottom:10px;">🗑️ Reiniciar Rifa (Zerar Tudo)</button>`;
    html += `<button class="primary" onclick="location.reload()">Sair do Painel</button>`;
    
    document.getElementById("step-selection").style.display = "block";
    document.getElementById("step-pix").style.display = "none";
    document.getElementById("step-selection").innerHTML = html;
  } catch (e) {
    alert("Erro ao acessar o painel.");
  }
}

async function confirmPay(orderId) {
  if (!confirm("Confirmar que o pagamento foi recebido na conta?")) return;
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminConfirmPayment", order_id: orderId, token: adminTokenCache })
  });
  const data = await res.json();
  if (data.success) {
    loginAdmin();
  } else {
    alert("Erro ao confirmar: " + (data.error || "Tente novamente"));
  }
}

async function cancelOrderAction(orderId) {
  if (!confirm("Deseja realmente cancelar este pedido e liberar os números para outras pessoas?")) return;
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminCancelOrder", order_id: orderId, token: adminTokenCache })
  });
  const data = await res.json();
  if (data.success) {
    loginAdmin();
  } else {
    alert("Erro ao cancelar pedido.");
  }
}

async function resetDatabaseAction() {
  if (!confirm("ATENÇÃO: Deseja apagar todos os registros e liberar TODAS as cotas para uma nova rifa? Esta ação é crítica e irreversível!")) return;
  const res = await fetch(API_URL, {
    method: "POST",
    body: JSON.stringify({ action: "adminResetDatabase", token: adminTokenCache })
  });
  const data = await res.json();
  if (data.success) {
    alert("Rifa reiniciada com sucesso!");
    location.reload();
  } else {
    alert("Erro ao reiniciar rifa.");
  }
}

// GERADOR DE MAPA DE STATUS LIMPO (SEM CORTES)
function generateRaffleImage() {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;  
  canvas.height = 1920; // Altura corrigida com espaço de sobra para não cortar nada
  const ctx = canvas.getContext("2d");

  // 1. Fundo Gradiente Escuro Sofisticado
  const bgGradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bgGradient.addColorStop(0, "#0f172a");  
  bgGradient.addColorStop(1, "#1e1b4b");
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 2. Cabeçalho Minimalista
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("📊 STATUS ATUAL DAS COTAS", canvas.width / 2, 75);

  ctx.font = "500 20px sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.fillText("Acompanhe os números disponíveis em tempo real", canvas.width / 2, 115);

  // 3. Legenda Compacta
  let legendY = 175;
  ctx.font = "bold 16px sans-serif";
  
  // Livre
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.roundRect(220, legendY - 12, 18, 18, 4); ctx.fill();
  ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "left"; ctx.fillText("LIVRE", 248, legendY);

  // Reservado
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath(); ctx.roundRect(470, legendY - 12, 18, 18, 4); ctx.fill();
  ctx.fillStyle = "#cbd5e1"; ctx.fillText("RESERVADO", 498, legendY);

  // Pago
  ctx.fillStyle = "#ef4444";
  ctx.beginPath(); ctx.roundRect(740, legendY - 12, 18, 18, 4); ctx.fill();
  ctx.fillStyle = "#cbd5e1"; ctx.fillText("PAGO", 768, legendY);

  // 4. Grade de Números (10 Colunas x 20 Linhas)
  let cols = 10;
  let size = 68; 
  let gap = 10;
  let totalGridWidth = (cols * size) + ((cols - 1) * gap);
  let startX = (canvas.width - totalGridWidth) / 2;
  let startY = 230;

  cachedNumbersData.forEach((item, index) => {
    let col = index % cols;
    let row = Math.floor(index / cols);
    let x = startX + col * (size + gap);
    let y = startY + row * (size + gap);

    ctx.beginPath();
    ctx.roundRect(x, y, size, size, 10);

    if (item.status === "PAID") {
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
    } else if (item.status === "RESERVED") {
      ctx.fillStyle = "#f59e0b";
      ctx.fill();
      ctx.fillStyle = "#ffffff";
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.fillStyle = "#0f172a";
    }

    // Texto do Número
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(item.number, x + size / 2, y + size / 2);
  });

  // 5. Rodapé Informativo Posicionado com Folga Segura
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 18px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("🔗 Consulte o link da mensagem principal para garantir sua cota!", canvas.width / 2, 1860);

  // Download Automático da Imagem Ajustada
  const link = document.createElement("a");
  link.download = `status-cotas-${new Date().toISOString().slice(0,10)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}