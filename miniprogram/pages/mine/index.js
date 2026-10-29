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
      canCheckout: item.status === 'upcoming' && start <= Date.now(),
      imageUrl: item.volunteerImage ? api.asset(item.volunteerImage) : ''
    });
  });
}

Page({
  data: {
    phone: '', queriedPhone: '', kind: 'borrows', period: 'active', records: [],
    accepted: false, loading: false, busy: false, error: '', queried: false
  },
  onLoad() { this.savedPhone = ui.profile().phone || ''; this.setData({ phone: this.savedPhone }); },
  onShow() {
    const phone = ui.profile().phone || '';
    if (phone !== this.savedPhone) {
      this.savedPhone = phone;
      this.sequence = (this.sequence || 0) + 1;
      this.setData({ phone, queriedPhone: '', records: [], queried: false, accepted: false, error: '', loading: false });
    }
    if (this.data.queriedPhone && this.data.phone === this.data.queriedPhone) this.load();
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  phoneInput(event) {
    this.sequence = (this.sequence || 0) + 1;
    this.setData({ phone: event.detail.value, queriedPhone: '', queried: false, records: [], error: '', loading: false });
  },
  consent: ui.consent,
  privacy: ui.privacy,
  async query() {
    if (this.data.busy) return;
    try {
      const phone = this.data.phone.trim();
      if (!/^\d{11}$/.test(phone)) throw new Error('请输入 11 位手机号');
      ui.requireConsent(this.data.accepted);
      const old = ui.profile();
      ui.saveProfile({ phone, name: old.phone === phone ? old.name : '', card: old.phone === phone ? old.card : '' });
      this.savedPhone = phone;
      this.setData({ phone, queriedPhone: phone });
      await this.load();
    } catch (error) { ui.errorMessage(error); }
  },
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
    const phone = this.data.queriedPhone;
    if (!/^\d{11}$/.test(phone) || phone !== this.data.phone.trim()) {
      this.setData({ queried: false, records: [], loading: false });
      return;
    }
    const sequence = this.sequence = (this.sequence || 0) + 1;
    const kind = this.data.kind;
    const period = this.data.period;
    const endpoint = kind === 'borrows' ? '/api/borrows' : kind === 'rooms' ? '/api/room/bookings' : '/api/reviews/mine';
    const tab = kind === 'rooms' ? (period === 'active' ? 'upcoming' : 'history') : period;
    this.setData({ loading: true, error: '', records: [], queried: true });
    try {
      const records = await api.request(endpoint, 'GET', kind === 'reviews' ? { phone } : { phone, tab });
      if (sequence === this.sequence) this.setData({ records: decorate(records, kind) });
    } catch (error) {
      if (sequence === this.sequence) this.setData({ error: error.message, records: [] });
    } finally {
      if (sequence === this.sequence) this.setData({ loading: false });
    }
  },
  action(event) {
    return ui.run(this, async () => {
      const id = String(event.currentTarget.dataset.id);
      const action = event.currentTarget.dataset.action;
      const record = this.data.records.find(item => String(item.id) === id);
      const phone = this.data.queriedPhone;
      if (!record || !phone || phone !== this.data.phone.trim()) throw new Error('请重新查询后操作');
      const messages = {
        return: '请确认图书已交还到馆。确认后将完成归还登记。',
        renew: '续借将延长 30 天，每本书限续借一次。',
        cancel: '确认取消这次活动室预约？',
        delete: '确认删除这篇读后感？删除后无法恢复。'
      };
      if (!messages[action]) return;
      if (!(await ui.confirm(messages[action]))) return;
      let path;
      let method = 'POST';
      if (action === 'return' || action === 'renew') path = '/api/borrows/' + encodeURIComponent(id) + '/' + action;
      else if (action === 'cancel') path = '/api/room/bookings/' + encodeURIComponent(id) + '/cancel';
      else { path = '/api/reviews/' + encodeURIComponent(id); method = 'DELETE'; }
      await api.request(path, method, { phone });
      await this.load();
      ui.success({ return: '归还成功', renew: '续借成功', cancel: '已取消预约', delete: '已删除' }[action]);
    });
  },
  checkout(event) {
    const id = event.currentTarget.dataset.id;
    const record = this.data.records.find(item => item.id === id);
    if (!record || !record.canCheckout || this.data.busy) return;
    wx.navigateTo({ url: '/pages/checkout/index?' + api.query({ id, phone: this.data.queriedPhone }) });
  },
  review(event) {
    if (this.data.busy) return;
    wx.navigateTo({ url: '/pages/review/index?' + api.query({ bookId: event.currentTarget.dataset.bookId, id: event.currentTarget.dataset.id || '' }) });
  },
  book(event) { wx.navigateTo({ url: '/pages/book/index?id=' + encodeURIComponent(event.currentTarget.dataset.bookId) }); },
  preview: ui.preview,
  admin() { wx.navigateTo({ url: '/pages/admin/index' }); },
  clearLocal() {
    return ui.run(this, async () => {
      if (!(await ui.confirm('清空本机保存的姓名、手机号和借阅证号？服务端借阅和预约记录仍会保留。'))) return;
      wx.removeStorageSync('yuexiang_profile');
      this.savedPhone = '';
      this.sequence = (this.sequence || 0) + 1;
      this.setData({ phone: '', queriedPhone: '', records: [], accepted: false, queried: false, error: '', loading: false });
      ui.success('已清空本机信息');
    });
  }
});
