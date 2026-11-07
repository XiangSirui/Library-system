const api = require('../../utils/api');
const ui = require('../../utils/ui');
function decorate(items, kind) {
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return ui.records(items.map(item => Object.assign({}, item, {
    overdue: kind === 'borrows' && item.status === 'borrowed' && item.dueDate < today
  }))).map(item => {
    const start = kind === 'rooms' ? Date.parse(item.date + 'T' + item.timeSlot + ':00+08:00') : 0;
    return Object.assign({}, item, {
      canCancel: item.status === 'upcoming' && start - Date.now() >= 3600000,
      canAccess: item.status === 'upcoming' && start + item.duration * 3600000 > Date.now(),
      canCheckout: item.status === 'upcoming' && start <= Date.now()
    });
  });
}
Page({
  data: { user: null, phone: '', kind: 'borrows', period: 'active', records: [],
    access: null, accepted: false, loading: false, busy: false, error: '', queried: false },
  onShow() { this.syncUser(); if (this.data.user) this.load(); },
  onHide() { this.closeAccess(); },
  onUnload() { this.closeAccess(); },
  closeAccess() {
    clearTimeout(this.accessTimer);
    this.accessSequence = (this.accessSequence || 0) + 1;
    this.setData({ access: null });
  },
  expireAccess() {
    clearTimeout(this.accessTimer);
    if (!this.data.access) return;
    if (!api.user() || !this.data.user || api.user().id !== this.data.user.id) { this.closeAccess(); return; }
    const remaining = Date.parse(this.data.access.expiresAt) - Date.now();
    if (remaining <= 0) { this.closeAccess(); return; }
    this.accessTimer = setTimeout(() => this.expireAccess(), Math.min(remaining, 60000));
  },
  showAccess(event) {
    return ui.run(this, async () => {
      this.closeAccess();
      const sequence = this.accessSequence;
      const id = event.currentTarget.dataset.id;
      const record = this.data.records.find(item => item.id === id);
      const user = api.user();
      if (!record || !user || !this.data.user || user.id !== this.data.user.id) throw new Error('请重新登录后操作');
      const result = await api.request('/api/room/bookings/' + encodeURIComponent(id) + '/access');
      if (sequence !== this.accessSequence || !api.user() || api.user().id !== user.id) return;
      if (!result.available) { wx.showModal({ title: '门锁密码', content: result.reason, showCancel: false }); return; }
      this.setData({ access: Object.assign({}, result, { id, date: record.date, timeSlot: record.timeSlot }) }, () => wx.pageScrollTo({ selector: '#doorAccess', duration: 200 }));
      this.expireAccess();
    });
  },
  syncUser() {
    const user = api.user();
    if ((user && user.id) !== (this.data.user && this.data.user.id)) {
      this.closeAccess();
      this.sequence = (this.sequence || 0) + 1;
      this.setData({ user, phone: '', records: [], queried: false, loading: false, error: '' });
    }
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  consent: ui.consent, privacy: ui.privacy,
  login() {
    return ui.run(this, async () => {
      ui.requireConsent(this.data.accepted);
      await api.login();
      this.syncUser();
      await this.load();
    });
  },
  logout() {
    return ui.run(this, async () => {
      try { await api.logout(); }
      finally { this.syncUser(); this.setData({ accepted: false }); }
    });
  },
  phoneInput(event) { this.setData({ phone: event.detail.value }); },
  kindTap(event) {
    if (this.data.busy) return;
    this.setData({ kind: event.currentTarget.dataset.kind, records: [] });
    this.load();
  },
  periodTap(event) {
    if (this.data.busy) return;
    this.setData({ period: event.currentTarget.dataset.period, records: [] });
    this.load();
  },
  async load() {
    this.closeAccess();
    this.syncUser();
    if (!this.data.user) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    const phone = this.data.phone.trim();
    if (phone && !/^[0-9]{11}$/.test(phone)) {
      this.setData({ error: '请输入正确的 11 位手机号，或留空查看全部本人记录', records: [], queried: true, loading: false });
      return;
    }
    const userId = this.data.user.id, kind = this.data.kind, period = this.data.period;
    const endpoint = kind === 'borrows' ? '/api/borrows' : kind === 'rooms' ? '/api/room/bookings' : '/api/reviews/mine';
    const tab = kind === 'rooms' ? (period === 'active' ? 'upcoming' : 'history') : period;
    this.setData({ loading: true, error: '', records: [], queried: true });
    try {
      const records = await api.request(endpoint, 'GET', Object.assign(kind === 'reviews' ? {} : { tab }, phone ? { phone } : {}));
      if (sequence === this.sequence && api.user() && api.user().id === userId) this.setData({ records: decorate(records, kind) });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ error: error.message, records: [] });
      this.syncUser();
    } finally {
      if (sequence === this.sequence) this.setData({ loading: false });
    }
  },
  action(event) {
    return ui.run(this, async () => {
      const id = String(event.currentTarget.dataset.id), action = event.currentTarget.dataset.action;
      const record = this.data.records.find(item => String(item.id) === id);
      const user = api.user();
      if (!record || !user || !this.data.user || user.id !== this.data.user.id) throw new Error('请重新登录后操作');
      const messages = { return: '请确认图书已交还到馆。确认后将完成归还登记。', renew: '续借将延长 30 天，每本书限续借一次。', cancel: '确认取消这次活动室预约？', delete: '确认删除这篇读后感？删除后无法恢复。' };
      if (!messages[action] || !(await ui.confirm(messages[action]))) return;
      const path = action === 'return' || action === 'renew' ? '/api/borrows/' + encodeURIComponent(id) + '/' + action
        : action === 'cancel' ? '/api/room/bookings/' + encodeURIComponent(id) + '/cancel' : '/api/reviews/' + encodeURIComponent(id);
      await api.request(path, action === 'delete' ? 'DELETE' : 'POST');
      await this.load();
      ui.success({ return: '归还成功', renew: '续借成功', cancel: '已取消预约', delete: '已删除' }[action]);
    });
  },
  checkout(event) {
    const record = this.data.records.find(item => item.id === event.currentTarget.dataset.id);
    if (record && record.canCheckout && !this.data.busy) wx.navigateTo({ url: '/pages/checkout/index?id=' + encodeURIComponent(record.id) });
  },
  review(event) {
    if (!this.data.busy) wx.navigateTo({ url: '/pages/review/index?' + api.query({ bookId: event.currentTarget.dataset.bookId, id: event.currentTarget.dataset.id || '' }) });
  },
  book(event) { wx.navigateTo({ url: '/pages/book/index?id=' + encodeURIComponent(event.currentTarget.dataset.bookId) }); },
  preview(event) {
    return ui.run(this, async () => {
      const path = await api.downloadPhoto(event.currentTarget.dataset.path);
      wx.previewImage({ current: path, urls: [path] });
    });
  },
  admin() { wx.navigateTo({ url: '/pages/admin/index' }); },
  clearLocal() {
    return ui.run(this, async () => {
      if (!(await ui.confirm('清空本机保存的姓名、手机号和借阅证号？已提交的业务记录仍会保留。'))) return;
      wx.removeStorageSync('yuexiang_profile');
      ui.success('已清空本机信息');
    });
  }
});
