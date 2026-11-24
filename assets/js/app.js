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

        async generateWhatsappSummaryImage() {
            const canvas = document.getElementById('shareCanvas');
            if (!canvas) return;

            if (!Array.isArray(this.numbers) || this.numbers.length === 0) {
                this.notify('Não há cotas carregadas para gerar a imagem.', 'error');
                return;
            }

            if (document.fonts && document.fonts.ready) {
                try {
                    await document.fonts.ready;
                } catch (_) {}
            }

            const ctx = canvas.getContext('2d');
            const totalNumbers = this.numbers.length;
            const chunkSize = 100;
            const allSlices = [];

            for (let i = 0; i < totalNumbers; i += chunkSize) {
                const items = this.numbers.slice(i, i + chunkSize);
                const counts = { available: 0, reserved: 0, paid: 0 };

                items.forEach(item => {
                    const cat = this.classifyQuotaForShare(item.status);
                    counts[cat]++;
                });

                allSlices.push({
                    index: allSlices.length + 1,
                    items,
                    firstNumber: items[0].number,
                    lastNumber: items[items.length - 1].number,
                    counts
                });
            }

            const totalPages = allSlices.length;
            const hasAnyAvailable = allSlices.some(slice => slice.counts.available > 0);
            const slicesToExport = hasAnyAvailable
                ? allSlices.filter(slice => slice.counts.available > 0)
                : allSlices;

            const skippedPages = totalPages - slicesToExport.length;
            const raffleName = String(this.config.raffle_name || this.config.title || 'Rifa Solidária').trim();
            const priceText = `${this.formatCurrency(this.config.ticket_price)} por cota`;
            const organizerPhone = this.config.whatsapp ? this.formatPhoneDisplay(this.config.whatsapp) : '';
            const slugBase = this.normalizeText(raffleName).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rifa';

            const now = new Date();
            const timestampText = `Atualizado em ${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

            // Tokens visuais extraídos diretamente da interface (index.html / Tailwind Zinc + Emerald + Amber)
            const palette = {
                outerBg: '#fafafa',       // zinc-50
                cardBg: '#ffffff',        // white
                cardBorder: '#e4e4e7',    // zinc-200
                divider: '#f4f4f5',       // zinc-100
                textPrimary: '#18181b',   // zinc-900
                textSecondary: '#52525b', // zinc-600
                textMuted: '#71717a',     // zinc-500
                emeraldBg: '#ecfdf5',     // emerald-50
                emeraldBorder: '#a7f3d0', // emerald-200
                emeraldText: '#065f46',   // emerald-800
                emeraldSolid: '#047857',  // emerald-700
                availBg: '#ffffff',
                availBorder: '#a1a1aa',   // zinc-300
                availText: '#18181b',     // zinc-900
                resBg: '#fffbeb',         // amber-50
                resBorder: '#fcd34d',     // amber-300
                resText: '#92400e',       // amber-800
                paidBg: '#f4f4f5',        // zinc-100
                paidBorder: '#ededf0',    // zinc-200
                paidText: '#b4b4bc'       // zinc-400
            };

            const fontFamily = '"Plus Jakarta Sans", system-ui, -apple-system, sans-serif';
            const canvasWidth = 1080;
            const outerMargin = 48;
            const cardX = outerMargin;
            const cardY = outerMargin;
            const cardW = canvasWidth - outerMargin * 2; // 984
            const innerPad = 48;
            const contentX = cardX + innerPad;
            const contentW = cardW - innerPad * 2; // 888

            const cols = 10;
            const gap = 10;
            const cellSize = Math.floor((contentW - gap * (cols - 1)) / cols); // 79px
            const gridTotalW = cellSize * cols + gap * (cols - 1);
            const gridStartX = contentX + Math.floor((contentW - gridTotalW) / 2);

            for (let i = 0; i < slicesToExport.length; i++) {
                const slice = slicesToExport[i];
                const rows = Math.ceil(slice.items.length / cols);
                const gridH = rows * cellSize + (rows - 1) * gap;

                const headerH = 228;
                const statusBarH = 92;
                const footerH = 118;
                const cardH = headerH + statusBarH + gridH + footerH + 36;
                const canvasHeight = cardH + outerMargin * 2;

                canvas.width = canvasWidth;
                canvas.height = canvasHeight;

                // Fundo externo limpo
                ctx.fillStyle = palette.outerBg;
                ctx.fillRect(0, 0, canvasWidth, canvasHeight);

                // Cartão principal (espelha section.bg-white.rounded-3xl.border-zinc-200)
                ctx.fillStyle = palette.cardBg;
                ctx.beginPath();
                ctx.roundRect(cardX, cardY, cardW, cardH, 32);
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = palette.cardBorder;
                ctx.stroke();

                // 1. Cabeçalho: Badge de valor + Paginação + Título + Faixa
                let cursorY = cardY + 46;

                // Badge do valor da cota (espelha span.bg-emerald-50.border-emerald-200.text-emerald-800)
                ctx.font = `800 24px ${fontFamily}`;
                const priceMetrics = ctx.measureText(priceText);
                const badgePadX = 22;
                const badgeH = 46;
                const badgeW = Math.ceil(priceMetrics.width + badgePadX * 2);

                ctx.fillStyle = palette.emeraldBg;
                ctx.beginPath();
                ctx.roundRect(contentX, cursorY, badgeW, badgeH, 999);
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = palette.emeraldBorder;
                ctx.stroke();

                ctx.fillStyle = palette.emeraldText;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(priceText, contentX + badgePadX, cursorY + badgeH / 2 + 1);

                // Indicador de faixa/página à direita (quando houver mais de 100 cotas)
                if (totalPages > 1) {
                    const pageLabel = `Faixa ${slice.index} de ${totalPages}`;
                    ctx.font = `700 23px ${fontFamily}`;
                    const pageMetrics = ctx.measureText(pageLabel);
                    const pagePillW = Math.ceil(pageMetrics.width + 32);

                    ctx.fillStyle = palette.divider;
                    ctx.beginPath();
                    ctx.roundRect(contentX + contentW - pagePillW, cursorY, pagePillW, badgeH, 999);
                    ctx.fill();

                    ctx.fillStyle = palette.textSecondary;
                    ctx.textAlign = 'center';
                    ctx.fillText(pageLabel, contentX + contentW - pagePillW / 2, cursorY + badgeH / 2 + 1);
                }

                // Título da campanha (ajuste automático para títulos longos)
                cursorY += badgeH + 26;
                let titleFontSize = 44;
                ctx.font = `800 ${titleFontSize}px ${fontFamily}`;
                while (ctx.measureText(raffleName).width > contentW && titleFontSize > 30) {
                    titleFontSize -= 2;
                    ctx.font = `800 ${titleFontSize}px ${fontFamily}`;
                }
                ctx.fillStyle = palette.textPrimary;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.fillText(raffleName, contentX, cursorY);

                // Subtítulo com o intervalo exato da faixa
                cursorY += titleFontSize + 12;
                ctx.font = `600 26px ${fontFamily}`;
                ctx.fillStyle = palette.textSecondary;
                ctx.fillText(`Números ${slice.firstNumber} a ${slice.lastNumber}`, contentX, cursorY);

                // 2. Barra de resumo + legenda dos 3 status
                const barY = cardY + headerH;
                ctx.fillStyle = palette.outerBg;
                ctx.beginPath();
                ctx.roundRect(contentX, barY, contentW, statusBarH, 18);
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = palette.cardBorder;
                ctx.stroke();

                const legendItems = [
                    {
                        label: 'Disponíveis',
                        count: slice.counts.available,
                        bg: palette.availBg,
                        border: palette.availBorder,
                        countColor: palette.textPrimary,
                        strike: false
                    },
                    {
                        label: 'Reservadas',
                        count: slice.counts.reserved,
                        bg: palette.resBg,
                        border: palette.resBorder,
                        countColor: palette.resText,
                        strike: false
                    },
                    {
                        label: 'Pagas',
                        count: slice.counts.paid,
                        bg: palette.paidBg,
                        border: palette.paidBorder,
                        countColor: palette.textMuted,
                        strike: true
                    }
                ];

                const colWidth = contentW / 3;
                legendItems.forEach((leg, idx) => {
                    const blockX = contentX + idx * colWidth;
                    const centerY = barY + statusBarH / 2;

                    // Divisória vertical sutil entre os 3 indicadores
                    if (idx > 0) {
                        ctx.strokeStyle = palette.cardBorder;
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.moveTo(blockX, barY + 18);
                        ctx.lineTo(blockX, barY + statusBarH - 18);
                        ctx.stroke();
                    }

                    // Amostra fiel da célula da grade
                    const swatchSize = 26;
                    const swatchX = blockX + 26;
                    const swatchY = centerY - swatchSize / 2;

                    ctx.fillStyle = leg.bg;
                    ctx.beginPath();
                    ctx.roundRect(swatchX, swatchY, swatchSize, swatchSize, 7);
                    ctx.fill();
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = leg.border;
                    ctx.stroke();

                    if (leg.strike) {
                        ctx.strokeStyle = palette.paidText;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(swatchX + 6, centerY);
                        ctx.lineTo(swatchX + swatchSize - 6, centerY);
                        ctx.stroke();
                    }

                    // Número da contagem + rótulo
                    const textStartX = swatchX + swatchSize + 14;
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.font = `800 28px ${fontFamily}`;
                    ctx.fillStyle = leg.countColor;
                    const countStr = String(leg.count);
                    ctx.fillText(countStr, textStartX, centerY + 1);

                    const countW = ctx.measureText(countStr).width;
                    ctx.font = `600 22px ${fontFamily}`;
                    ctx.fillStyle = palette.textSecondary;
                    ctx.fillText(leg.label, textStartX + countW + 8, centerY + 1);
                });

                // 3. Grade central de cotas (10 colunas)
                const gridStartY = barY + statusBarH + 28;
                const maxDigits = String(slice.lastNumber).length;
                const cellFontSize = maxDigits >= 4 ? 22 : 26;

                slice.items.forEach((item, idx) => {
                    const row = Math.floor(idx / cols);
                    const col = idx % cols;
                    const x = gridStartX + col * (cellSize + gap);
                    const y = gridStartY + row * (cellSize + gap);
                    const category = this.classifyQuotaForShare(item.status);

                    let bg = palette.availBg;
                    let border = palette.availBorder;
                    let textColor = palette.availText;
                    let fontWeight = '800';
                    let lineWidth = 2;

                    if (category === 'reserved') {
                        bg = palette.resBg;
                        border = palette.resBorder;
                        textColor = palette.resText;
                        fontWeight = '700';
                        lineWidth = 2;
                    } else if (category === 'paid') {
                        bg = palette.paidBg;
                        border = palette.paidBorder;
                        textColor = palette.paidText;
                        fontWeight = '600';
                        lineWidth = 1;
                    }

                    ctx.fillStyle = bg;
                    ctx.beginPath();
                    ctx.roundRect(x, y, cellSize, cellSize, 14);
                    ctx.fill();

                    ctx.lineWidth = lineWidth;
                    ctx.strokeStyle = border;
                    ctx.stroke();

                    const label = String(item.number);
                    ctx.font = `${fontWeight} ${cellFontSize}px ${fontFamily}`;
                    ctx.fillStyle = textColor;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, x + cellSize / 2, y + cellSize / 2 + 1);

                    // Traço discreto apenas nas pagas (espelha line-through da interface)
                    if (category === 'paid') {
                        const numW = ctx.measureText(label).width;
                        const strikeW = Math.min(numW + 8, cellSize - 18);
                        ctx.strokeStyle = palette.paidText;
                        ctx.lineWidth = 2;
                        ctx.beginPath();
                        ctx.moveTo(x + (cellSize - strikeW) / 2, y + cellSize / 2);
                        ctx.lineTo(x + (cellSize + strikeW) / 2, y + cellSize / 2);
                        ctx.stroke();
                    }
                });

                // 4. Rodapé limpo para compartilhamento no WhatsApp
                const footerTopY = gridStartY + gridH + 28;
                ctx.strokeStyle = palette.cardBorder;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(contentX, footerTopY);
                ctx.lineTo(contentX + contentW, footerTopY);
                ctx.stroke();

                const ctaY = footerTopY + 38;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.font = `700 24px ${fontFamily}`;
                ctx.fillStyle = palette.textPrimary;
                const ctaText = organizerPhone
                    ? `Escolha seu número livre e peça pelo WhatsApp: ${organizerPhone}`
                    : 'Escolha seu número livre e envie mensagem para reservar.';
                ctx.fillText(ctaText, contentX, ctaY);

                ctx.font = `500 21px ${fontFamily}`;
                ctx.fillStyle = palette.textMuted;
                ctx.fillText(timestampText, contentX, ctaY + 34);

                // Exportação do arquivo PNG da faixa
                const fileName = `${slugBase}-${slice.firstNumber}-${slice.lastNumber}.png`;
                const dataUrl = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.download = fileName;
                link.href = dataUrl;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                if (i < slicesToExport.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
            }

            const totalGenerated = slicesToExport.length;
            const summaryMsg = totalGenerated === 1
                ? 'Imagem gerada e pronta para compartilhar no WhatsApp.'
                : `${totalGenerated} imagens geradas por faixa e prontas para compartilhar no WhatsApp.`;
            const skippedNote = skippedPages > 0
                ? ` (${skippedPages} faixa(s) esgotada(s) omitida(s))`
                : '';

            this.notify(summaryMsg + skippedNote, 'success');
        },

        classifyQuotaForShare(status) {
            const normalized = String(status || '').toUpperCase().trim();
            if (normalized === 'PAID') return 'paid';
            if (normalized === 'PENDING' || normalized === 'RESERVED' || normalized === 'PAYMENT_REPORTED') {
                return 'reserved';
            }
            // AVAILABLE, CANCELLED e REFUNDED representam cotas livres na grade
            return 'available';
        },

        classifyQuotaForShare(status) {
            const normalized = String(status || '').toUpperCase().trim();
            if (normalized === 'PAID') return 'paid';
            if (normalized === 'PENDING' || normalized === 'RESERVED' || normalized === 'PAYMENT_REPORTED') {
                return 'reserved';
            }
            // AVAILABLE, CANCELLED e REFUNDED representam cotas livres na grade
            return 'available';
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
