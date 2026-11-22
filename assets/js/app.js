// Cliente HTTP compatível com Google Apps Script Web Apps (evita preflight OPTIONS e segue 302).
async function gasGet(action) {
    const url = `${API_URL}?action=${encodeURIComponent(action)}&_t=${Date.now()}`;
    const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow'
    });
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error('Resposta inválida do servidor.');
    }
}

async function gasPost(payload) {
    const res = await fetch(API_URL, {
        method: 'POST',
        redirect: 'follow',
        headers: {
            'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(payload)
    });
    const text = await res.text();
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error('Resposta inválida do servidor.');
    }
}

// Lógica principal da interface.
function raffleApp() {
    return {
        darkMode: false,
        currentTab: 'rifa',
        loading: true,
        submitting: false,
        toasts: [],

        config: {},
        numbers: [],
        selectedNumbers: [],
        filterMode: 'AVAILABLE',
        searchNumberQuery: '',
        currentRangeIndex: 0,
        rangeSize: 100,

        showCheckoutModal: false,
        showRulesModal: false,
        showDrawModal: false,

        buyerName: '',
        buyerWhatsapp: '',

        savedOrders: [],
        expandedOrders: {},
        pixCopied: false,

        adminAuthenticated: false,
        adminPassword: '',
        adminOrders: [],
        adminSearch: '',
        adminStatusFilter: 'ALL',
        drawResult: null,
        showConfigEditor: false,
        adminConfigDraft: {},
        refreshingOrders: false,
        refreshingAdminData: false,

        get defaultDrawRules() {
            return 'O sorteio será realizado pelo próprio sistema, considerando exclusivamente as cotas com pagamento confirmado. O resultado oficial será registrado e divulgado nesta página.';
        },

        get hasCampaignOrders() {
            return Array.isArray(this.adminOrders) && this.adminOrders.length > 0;
        },

        get lockCommercialConfig() {
            return this.hasCampaignOrders || String(this.config.campaign_status || 'OPEN').toUpperCase() !== 'OPEN';
        },

        get campaignClosed() {
            return ['CLOSED', 'DRAWN'].includes(String(this.config.campaign_status || 'OPEN').toUpperCase());
        },

        init() {
            const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
            if (savedTheme === 'dark' || (!savedTheme && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                this.darkMode = true;
                document.documentElement.classList.add('dark');
            }

            this.loadSavedOrders();
            this.fetchPublicData();

            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    this.fetchPublicData();
                    if (this.currentTab === 'admin' && this.adminAuthenticated) {
                        this.loadAdminData();
                    }
                }
            });
        },

        toggleTheme() {
            this.darkMode = !this.darkMode;
            document.documentElement.classList.toggle('dark', this.darkMode);
            localStorage.setItem(THEME_STORAGE_KEY, this.darkMode ? 'dark' : 'light');
        },

        notify(message, type = 'info') {
            const id = Date.now() + Math.random();
            this.toasts.push({ id, message, type });
            setTimeout(() => this.dismissToast(id), 4000);
        },

        dismissToast(id) {
            this.toasts = this.toasts.filter(t => t.id !== id);
        },

        formatCurrency(val) {
            const num = Number(String(val ?? 0).replace(',', '.'));
            return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(num) ? num : 0);
        },

        shortenOrderId(id) {
            if (!id) return '';
            const str = String(id);
            if (str.length <= 14) return str;
            return str.slice(0, 6) + '...' + str.slice(-6);
        },

        normalizeText(str) {
            if (!str) return '';
            return String(str).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        },

        formatPhoneDisplay(phone) {
            if (!phone) return '-';
            const clean = String(phone).replace(/\D/g, '');
            if (clean.length === 11) {
                return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
            }
            if (clean.length === 10) {
                return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
            }
            return phone;
        },

        handlePhoneInput(e) {
            const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 11);
            let formatted = digits;
            if (digits.length > 0) formatted = '(' + digits.slice(0, 2);
            if (digits.length >= 3) formatted += ') ' + digits.slice(2, 7);
            if (digits.length >= 8) formatted += '-' + digits.slice(7, 11);
            this.buyerWhatsapp = formatted;
        },

        handleAdminWhatsappInput(e) {
            const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 11);
            let formatted = digits;
            if (digits.length > 0) formatted = '(' + digits.slice(0, 2);
            if (digits.length >= 3) formatted += ') ' + digits.slice(2, 7);
            if (digits.length >= 8) formatted += '-' + digits.slice(7, 11);
            this.adminConfigDraft.whatsapp = formatted;
        },

        handleDrawDateInput(e) {
            const digits = String(e.target.value || '').replace(/\D/g, '').slice(0, 8);
            let formatted = digits;
            if (digits.length > 2) formatted = digits.slice(0, 2) + '/' + digits.slice(2);
            if (digits.length > 4) formatted = formatted.slice(0, 5) + '/' + digits.slice(4);
            this.adminConfigDraft.draw_date = formatted;
        },

        formatDrawDate(value) {
            if (!value) return '';
            const raw = String(value).trim();
            const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
            return raw;
        },

        buildOrganizerWhatsappLink() {
            const digits = String(this.config.whatsapp || '').replace(/\D/g, '');
            return digits.length === 11 ? 'https://wa.me/55' + digits : '#';
        },

        async switchTab(tab) {
            this.currentTab = tab;

            if (tab === 'pedidos') {
                await this.refreshLocalOrdersStatus();
            }

            if (tab === 'admin' && this.adminAuthenticated) {
                await Promise.all([this.fetchPublicData(), this.loadAdminData()]);
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        },

        isOrderExpanded(orderId) {
            return this.expandedOrders[orderId] === true;
        },

        toggleOrderAccordion(orderId) {
            this.expandedOrders[orderId] = !this.expandedOrders[orderId];
        },

        openOrderView(orderId) {
            this.switchTab('pedidos');
            this.expandedOrders[orderId] = true;
        },

        get availableCount() {
            return this.numbers.filter(n => n.status === 'AVAILABLE').length;
        },

        get percentSold() {
            if (!this.numbers.length) return 0;
            const sold = this.numbers.filter(n => n.status === 'PAID').length;
            return Math.round((sold / this.numbers.length) * 100);
        },

        get activePendingOrder() {
            return this.savedOrders.find(o => o.status === 'PENDING' || o.status === 'RESERVED') || null;
        },

        get pageRanges() {
            if (this.numbers.length <= this.rangeSize) return [];
            const ranges = [];
            const total = this.numbers.length;
            for (let i = 0; i < total; i += this.rangeSize) {
                const endIndex = Math.min(i + this.rangeSize, total);
                const firstNumber = this.numbers[i].number;
                const lastNumber = this.numbers[endIndex - 1].number;
                ranges.push({ label: `${firstNumber}–${lastNumber}`, start: i, end: endIndex });
            }
            return ranges;
        },

        get displayedNumbers() {
            let list = this.numbers;

            if (this.filterMode === 'AVAILABLE') {
                list = list.filter(n => n.status === 'AVAILABLE' || this.selectedNumbers.includes(n.number));
            }

            if (this.searchNumberQuery.trim()) {
                const q = this.searchNumberQuery.trim().toLowerCase();
                return list.filter(n => String(n.number).toLowerCase().includes(q));
            }

            if (this.pageRanges.length > 1) {
                const range = this.pageRanges[this.currentRangeIndex] || this.pageRanges[0];
                const visibleSet = new Set(this.numbers.slice(range.start, range.end).map(n => n.number));
                return list.filter(n => visibleSet.has(n.number));
            }

            return list;
        },

        setFilterMode(mode) {
            this.filterMode = mode;
            this.autoSelectAvailableRange();
        },

        get eligiblePaidNumbers() {
            return this.numbers.filter(n => n.status === 'PAID');
        },

        get adminStats() {
            const price = Number(String(this.config.ticket_price ?? 0).replace(',', '.')) || 0;
            const paidCount = this.numbers.filter(n => n.status === 'PAID').length;
            const reservedCount = this.numbers.filter(n => n.status === 'RESERVED' || n.status === 'PENDING').length;
            const reportedCount = this.adminOrders.filter(o => o.status === 'PAYMENT_REPORTED').length;
            const percentSold = this.numbers.length ? Math.round((paidCount / this.numbers.length) * 100) : 0;

            return {
                paidCount,
                reservedCount,
                reportedCount,
                percentSold,
                paidAmount: paidCount * price,
                reservedAmount: reservedCount * price
            };
        },

        get filteredAdminOrders() {
            let orders = this.adminOrders;
            if (this.adminStatusFilter !== 'ALL') {
                if (this.adminStatusFilter === 'RESERVED') {
                    orders = orders.filter(o => o.status === 'RESERVED' || o.status === 'PENDING');
                } else {
                    orders = orders.filter(o => o.status === this.adminStatusFilter);
                }
            }

            const query = this.normalizeText(this.adminSearch);
            const cleanQueryDigits = this.adminSearch.replace(/\D/g, '');

            if (query) {
                orders = orders.filter(o => {
                    const nameNorm = this.normalizeText(o.name);
                    const phoneDigits = String(o.whatsapp || o.phone || o.telefone || '').replace(/\D/g, '');
                    const orderIdNorm = this.normalizeText(o.order_id);
                    const numbersArr = String(o.numbers || '').split(',').map(s => s.trim().toLowerCase());

                    const matchName = nameNorm.includes(query);
                    const matchId = orderIdNorm.includes(query);
                    const matchPhone = cleanQueryDigits && phoneDigits.includes(cleanQueryDigits);
                    const matchCota = numbersArr.some(c => c === query || c.includes(query));

                    return matchName || matchId || matchPhone || matchCota;
                });
            }
            return orders;
        },

        toggleNumber(item) {
            if (!item || item.status !== 'AVAILABLE') return;
            const idx = this.selectedNumbers.indexOf(item.number);
            if (idx > -1) {
                this.selectedNumbers.splice(idx, 1);
            } else {
                this.selectedNumbers.push(item.number);
            }
        },

        selectRandomBatch(count) {
            const available = this.numbers.filter(n => n.status === 'AVAILABLE' && !this.selectedNumbers.includes(n.number));
            if (available.length === 0) {
                this.notify('Não há cotas disponíveis em quantidade suficiente.', 'error');
                return;
            }
            const shuffled = available.slice();
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const toSelect = shuffled.slice(0, count).map(n => n.number);
            this.selectedNumbers = [...this.selectedNumbers, ...toSelect];
            this.notify(`${toSelect.length} cota(s) selecionada(s) com sucesso!`, 'success');
        },

        autoSelectAvailableRange() {
            if (this.pageRanges.length <= 1) return;

            const currentRange = this.pageRanges[this.currentRangeIndex] || this.pageRanges[0];
            const blockNumbers = this.numbers.slice(currentRange.start, currentRange.end);
            const hasValid = this.filterMode === 'AVAILABLE'
                ? blockNumbers.some(n => n.status === 'AVAILABLE')
                : blockNumbers.length > 0;

            if (!hasValid) {
                for (let i = 0; i < this.pageRanges.length; i++) {
                    const range = this.pageRanges[i];
                    const items = this.numbers.slice(range.start, range.end);
                    const meetsCondition = this.filterMode === 'AVAILABLE'
                        ? items.some(n => n.status === 'AVAILABLE')
                        : items.length > 0;

                    if (meetsCondition) {
                        this.currentRangeIndex = i;
                        break;
                    }
                }
            }
        },

        async fetchPublicData() {
            try {
                const data = await gasGet('getPublicData');
                if (data && data.success) {
                    this.config = data.config || {};
                    this.numbers = Array.isArray(data.numbers) ? data.numbers : [];

                    const campaignId = this.config.campaign_id || this.config.updated_at || this.config.title;
                    const storedCampaignId = localStorage.getItem(CAMPAIGN_SIG_KEY);

                    if (storedCampaignId && campaignId && storedCampaignId !== String(campaignId)) {
                        localStorage.removeItem(STORAGE_KEY);
                        this.savedOrders = [];
                        this.expandedOrders = {};
                    }
                    if (campaignId) {
                        localStorage.setItem(CAMPAIGN_SIG_KEY, String(campaignId));
                    }

                    await this.refreshLocalOrdersStatusSilent();

                    this.selectedNumbers = this.selectedNumbers.filter(number =>
                        this.numbers.some(n => n.number === number && n.status === 'AVAILABLE')
                    );
                    this.autoSelectAvailableRange();
                } else {
                    this.notify((data && data.error) || 'Não foi possível carregar os dados da campanha.', 'error');
                }
            } catch (e) {
                this.notify('Não foi possível atualizar os dados. Verifique sua conexão e tente novamente.', 'error');
            } finally {
                this.loading = false;
            }
        },

        async submitReservation() {
            if (this.selectedNumbers.length === 0 || this.submitting || this.campaignClosed) return;

            const trimmedName = this.buyerName.trim();
            if (trimmedName.length < 2) {
                this.notify('Informe seu nome para continuar.', 'error');
                return;
            }

            const cleanPhone = this.buyerWhatsapp.replace(/\D/g, '');
            if (cleanPhone.length !== 11 || cleanPhone.charAt(2) !== '9') {
                this.notify('Confira o número de WhatsApp informado.', 'error');
                return;
            }

            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'createReservation',
                    name: trimmedName,
                    whatsapp: cleanPhone,
                    numbers: this.selectedNumbers
                });
                if (data && data.success && data.order) {
                    const newOrder = {
                        order_id: data.order.order_id,
                        access_token: data.order.access_token,
                        name: trimmedName,
                        whatsapp: cleanPhone,
                        numbers: this.selectedNumbers.slice().sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(', '),
                        total_amount: data.order.total_amount,
                        status: 'RESERVED'
                    };

                    this.saveOrderLocally(newOrder);
                    this.expandedOrders[newOrder.order_id] = true;
                    this.selectedNumbers = [];
                    this.buyerName = '';
                    this.buyerWhatsapp = '';
                    this.showCheckoutModal = false;
                    await this.switchTab('pedidos');
                    this.notify('Reserva realizada! Faça o pagamento via Pix para garantir suas cotas.', 'success');
                    this.fetchPublicData();
                } else {
                    this.notify((data && data.error) || 'Não foi possível concluir a reserva. Atualize a página e tente novamente.', 'error');
                    this.fetchPublicData();
                }
            } catch (e) {
                this.notify('Não foi possível conectar ao servidor. Tente novamente.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        async confirmPaymentReport(order) {
            if (!order || this.submitting) return;
            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'reportPayment',
                    order_id: order.order_id,
                    access_token: order.access_token
                });
                if (data && data.success) {
                    order.status = 'PAYMENT_REPORTED';
                    this.updateOrderLocally(order);
                    this.notify('Aviso de pagamento enviado ao organizador.', 'success');
                } else {
                    this.notify((data && data.error) || 'Erro ao registrar aviso.', 'error');
                }
            } catch (e) {
                this.notify('Não foi possível enviar o aviso de pagamento.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        copyPixKeyUniversal() {
            const key = this.config.pix_key;
            if (!key) return;

            const setFeedback = () => {
                this.pixCopied = true;
                this.notify('Chave Pix copiada.', 'success');
                setTimeout(() => { this.pixCopied = false; }, 3000);
            };

            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(key).then(setFeedback).catch(() => {
                    this.fallbackCopyText(key, setFeedback);
                });
            } else {
                this.fallbackCopyText(key, setFeedback);
            }
        },

        fallbackCopyText(text, callback) {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.top = '0';
            textArea.style.left = '0';
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            try {
                const successful = document.execCommand('copy');
                if (successful && callback) callback();
            } catch (_) {}
            document.body.removeChild(textArea);
        },

        loadSavedOrders() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                this.savedOrders = raw ? JSON.parse(raw) : [];
                if (this.savedOrders.length > 0) {
                    this.expandedOrders[this.savedOrders[0].order_id] = true;
                }
            } catch (_) {
                this.savedOrders = [];
            }
        },

        saveOrderLocally(order) {
            this.savedOrders.unshift(order);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedOrders));
        },

        updateOrderLocally(order) {
            const idx = this.savedOrders.findIndex(o => o.order_id === order.order_id);
            if (idx > -1) {
                this.savedOrders[idx] = { ...this.savedOrders[idx], ...order };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedOrders));
            }
        },

        async refreshLocalOrdersStatusSilent() {
            if (!this.savedOrders.length || this.refreshingOrders) return;
            this.refreshingOrders = true;
            try {
                const data = await gasPost({
                    action: 'getOrders',
                    orders: this.savedOrders.map(order => ({
                        order_id: order.order_id,
                        access_token: order.access_token
                    }))
                });
                if (!data || !data.success || !Array.isArray(data.results)) return;

                const byId = new Map(data.results.map(item => [item.order_id, item]));
                const retained = [];
                for (const localOrder of this.savedOrders) {
                    const result = byId.get(localOrder.order_id);
                    if (result && result.success && result.order) {
                        retained.push({ ...localOrder, ...result.order, access_token: localOrder.access_token });
                    } else if (result && result.code === 'ORDER_NOT_FOUND') {
                        // Pedido removido no servidor.
                    } else {
                        retained.push(localOrder);
                    }
                }
                this.savedOrders = retained;
                localStorage.setItem(STORAGE_KEY, JSON.stringify(retained));
            } catch (_) {
                // Mantém dados locais em falha temporária.
            } finally {
                this.refreshingOrders = false;
            }
        },

        async refreshLocalOrdersStatus() {
            await this.refreshLocalOrdersStatusSilent();
        },

        loadConfigDraft() {
            const c = this.config || {};
            this.adminConfigDraft = {
                raffle_name: c.raffle_name || c.title || '',
                prize: c.prize || '',
                ticket_price: String(c.ticket_price ?? ''),
                number_count: String(this.numbers.length || 0),
                draw_date: this.formatDrawDate(c.draw_date || ''),
                pix_key: c.pix_key || '',
                pix_receiver: c.pix_receiver || '',
                pix_bank: c.pix_bank || '',
                whatsapp: c.whatsapp ? this.formatPhoneDisplay(c.whatsapp) : '',
                description: c.description || '',
                banner_url: c.banner_url || '',
                draw_rules: c.draw_rules || ''
            };
        },

        async saveAdminConfig() {
            if (this.submitting) return;
            const draft = { ...this.adminConfigDraft };
            draft.whatsapp = String(draft.whatsapp || '').replace(/\D/g, '');
            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'adminSaveConfig',
                    token: this.adminPassword,
                    config: draft
                });
                if (data && data.success) {
                    this.showConfigEditor = false;
                    await this.fetchPublicData();
                    this.notify('Configuração salva com sucesso.', 'success');
                } else {
                    this.notify((data && data.error) || 'Não foi possível salvar a configuração.', 'error');
                }
            } catch (_) {
                this.notify('Falha de comunicação ao salvar a configuração.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        async closeCampaign() {
            if (this.submitting || !confirm('Encerrar as vendas agora? Depois disso, ninguém poderá reservar novas cotas.')) return;
            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'adminCloseCampaign',
                    token: this.adminPassword
                });
                if (data && data.success) {
                    await this.fetchPublicData();
                    this.notify('Vendas encerradas. O sorteio já pode ser realizado.', 'success');
                } else {
                    this.notify((data && data.error) || 'Não foi possível encerrar as vendas.', 'error');
                }
            } catch (_) {
                this.notify('Falha de comunicação ao encerrar as vendas.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        async adminLogin() {
            if (this.submitting) return;
            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'adminGetOrders',
                    token: this.adminPassword
                });
                if (data && data.success) {
                    this.adminAuthenticated = true;
                    this.adminOrders = data.orders || [];
                    this.notify('Painel autenticado!', 'success');
                } else {
                    this.notify((data && data.error) || 'Senha administrativa incorreta.', 'error');
                }
            } catch (_) {
                this.notify('Falha de autenticação.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        adminLogout() {
            this.adminAuthenticated = false;
            this.adminPassword = '';
            this.adminOrders = [];
        },

        async loadAdminData() {
            if (!this.adminAuthenticated || this.refreshingAdminData) return;
            this.refreshingAdminData = true;
            try {
                const data = await gasPost({
                    action: 'adminGetOrders',
                    token: this.adminPassword
                });
                if (data && data.success) {
                    this.adminOrders = data.orders || [];
                }
            } catch (_) {
                // Preserva os dados exibidos.
            } finally {
                this.refreshingAdminData = false;
            }
        },

        async adminConfirmOrder(orderId) {
            if (this.submitting) return;
            if (!confirm('Deseja confirmar o pagamento deste pedido?')) return;
            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'adminConfirmPayment',
                    order_id: orderId,
                    token: this.adminPassword
                });
                if (data && data.success) {
                    this.notify('Pagamento confirmado com sucesso!', 'success');
                    await this.loadAdminData();
                    await this.fetchPublicData();
                } else {
                    this.notify((data && data.error) || 'Erro ao confirmar.', 'error');
                }
            } catch (_) {
                this.notify('Erro na requisição.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        async adminCancelOrder(orderId) {
            if (this.submitting) return;
            const targetOrder = this.adminOrders.find(order => order.order_id === orderId);
            const isPaid = targetOrder && targetOrder.status === 'PAID';
            const confirmationText = isPaid
                ? 'ATENÇÃO: este pedido já está pago. Confirme somente se o valor já foi devolvido ao participante. O sistema registrará o estorno e liberará as cotas, mas NÃO movimenta dinheiro.'
                : 'Liberar as cotas deste pedido de volta para a rifa?';
            if (!confirm(confirmationText)) return;
            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'adminCancelOrder',
                    order_id: orderId,
                    token: this.adminPassword
                });
                if (data && data.success) {
                    this.notify('Cotas liberadas!', 'success');
                    await this.loadAdminData();
                    await this.fetchPublicData();
                } else {
                    this.notify((data && data.error) || 'Erro ao cancelar.', 'error');
                }
            } catch (_) {
                this.notify('Erro na requisição.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        async promptResetCampaign() {
            if (this.submitting) return;
            const firstConfirm = confirm('ATENÇÃO: deseja encerrar a campanha atual e iniciar uma nova rifa?\n\nTodas as cotas voltarão a ficar disponíveis e o histórico da campanha atual será reiniciado.');
            if (!firstConfirm) return;

            const typed = prompt('Para confirmar, digite RESET em letras maiúsculas:');
            if (typed !== 'RESET') {
                this.notify('A confirmação não foi realizada. Nenhuma alteração foi feita.', 'info');
                return;
            }

            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'adminResetDatabase',
                    token: this.adminPassword,
                    confirm: 'RESET',
                    confirmation: 'RESET'
                });
                if (data && data.success) {
                    localStorage.removeItem(STORAGE_KEY);
                    localStorage.removeItem(CAMPAIGN_SIG_KEY);
                    this.savedOrders = [];
                    this.expandedOrders = {};
                    this.adminOrders = [];
                    await this.fetchPublicData();
                    this.notify('Nova campanha iniciada. Todas as cotas estão disponíveis.', 'success');
                } else {
                    this.notify((data && data.error) || 'Erro ao resetar campanha.', 'error');
                }
            } catch (_) {
                this.notify('Erro na comunicação com o backend.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        openRaffleDrawModal() {
            this.drawResult = this.config.draw_result || null;
            this.showDrawModal = true;
        },

        async executeAuditableDraw() {
            if (this.submitting || !this.eligiblePaidNumbers.length) return;
            this.submitting = true;
            try {
                const data = await gasPost({
                    action: 'adminDrawWinner',
                    token: this.adminPassword
                });
                if (data && data.success && data.result) {
                    this.drawResult = data.result;
                    this.notify('Sorteio auditado registrado!', 'success');
                    await this.loadAdminData();
                    await this.fetchPublicData();
                } else {
                    this.notify((data && data.error) || 'Erro ao realizar o sorteio.', 'error');
                }
            } catch (_) {
                this.notify('Erro na comunicação com o servidor.', 'error');
            } finally {
                this.submitting = false;
            }
        },

        generateWhatsappSummaryImage() {
            const canvas = document.getElementById('shareCanvas');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');

            const grad = ctx.createLinearGradient(0, 0, 0, 1920);
            grad.addColorStop(0, '#064e3b');
            grad.addColorStop(1, '#022c22');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 1080, 1920);

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.font = 'bold 54px Plus Jakarta Sans, sans-serif';
            ctx.fillText(this.config.raffle_name || 'RIFA SOLIDÁRIA', 540, 180);

            ctx.font = '800 68px Plus Jakarta Sans, sans-serif';
            ctx.fillStyle = '#4ade80';
            ctx.fillText(this.config.prize || 'Grande Prêmio Beneficente', 540, 280);

            ctx.font = '600 40px Plus Jakarta Sans, sans-serif';
            ctx.fillStyle = '#ffffff';
            ctx.fillText(`Cota: ${this.formatCurrency(this.config.ticket_price)} | Chave Pix: ${this.config.pix_key || ''}`, 540, 370);

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.roundRect(80, 440, 920, 1260, 40);
            ctx.fill();

            ctx.fillStyle = '#1e293b';
            ctx.font = 'bold 42px Plus Jakarta Sans, sans-serif';
            ctx.fillText(`COTAS LIVRES ATUALIZADAS (${this.availableCount} DISPONÍVEIS)`, 540, 520);

            const availableNumbers = this.numbers.filter(n => n.status === 'AVAILABLE').slice(0, 60);
            let x = 140, y = 600, col = 0;
            availableNumbers.forEach(item => {
                ctx.fillStyle = '#f0fdf4';
                ctx.beginPath();
                ctx.roundRect(x - 45, y - 40, 110, 70, 14);
                ctx.fill();

                ctx.strokeStyle = '#059669';
                ctx.lineWidth = 3;
                ctx.stroke();

                ctx.fillStyle = '#065f46';
                ctx.font = 'bold 36px Plus Jakarta Sans, sans-serif';
                ctx.fillText(item.number, x + 10, y + 8);

                col++;
                x += 160;
                if (col >= 5) { col = 0; x = 140; y += 95; }
            });

            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 38px Plus Jakarta Sans, sans-serif';
            ctx.fillText(`Para reservar, chame no WhatsApp: ${this.config.whatsapp || ''}`, 540, 1800);

            const link = document.createElement('a');
            link.download = `cotas-livres-${Date.now()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
            this.notify('Imagem gerada e pronta para compartilhar no WhatsApp.', 'success');
        },

        translateStatus(status) {
            const map = {
                'PENDING': 'Reservado',
                'RESERVED': 'Reservado',
                'PAYMENT_REPORTED': 'Pagamento informado',
                'PAID': 'Pedido confirmado',
                'CANCELLED': 'Cancelado / Liberado',
                'REFUNDED': 'Estornado / Liberado'
            };
            return map[status] || status;
        },

        statusDescription(status) {
            const map = {
                'PENDING': 'Sua reserva está ativa. Faça o pagamento via Pix para garantir suas cotas.',
                'RESERVED': 'Sua reserva está ativa. Faça o pagamento via Pix para garantir suas cotas.',
                'PAYMENT_REPORTED': 'Você informou o pagamento. O organizador fará a conferência para confirmar sua reserva.',
                'PAID': 'Pagamento confirmado! Suas cotas estão garantidas para o sorteio.',
                'CANCELLED': 'Esta reserva foi cancelada e as cotas estão disponíveis novamente.',
                'REFUNDED': 'O organizador registrou o estorno e liberou as cotas. A devolução do valor é realizada fora do sistema.'
            };
            return map[status] || '';
        }
    };
}

document.addEventListener('alpine:init', () => {
    Alpine.data('raffleApp', raffleApp);
});
