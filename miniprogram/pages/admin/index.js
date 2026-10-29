const api = require('../../utils/api');
const ui = require('../../utils/ui');
const PANELS = [
  { value: 'dashboard', label: '概览' }, { value: 'books', label: '图书' },
  { value: 'borrows', label: '借阅' }, { value: 'reviews', label: '书评' },
  { value: 'rooms', label: '预约' }, { value: 'slots', label: '开放时段' }
];
const FILTERS = {
  books: [],
  borrows: [{ value: 'all', label: '全部' }, { value: 'active', label: '借阅中' }, { value: 'overdue', label: '已逾期' }, { value: 'returned', label: '已归还' }],
  reviews: [{ value: 'pending', label: '待审核' }, { value: 'approved', label: '已发布' }, { value: 'rejected', label: '待修改' }, { value: 'all', label: '全部' }],
  rooms: [{ value: 'all', label: '全部' }, { value: 'upcoming', label: '待使用 / 待签退' }, { value: 'checked_out', label: '已签退' }, { value: 'cancelled', label: '已取消' }]
};
const STAT_LABELS = [
  ['totalBooks', '馆藏种类'], ['totalCopies', '馆藏册数'], ['availableCopies', '可借册数'],
  ['activeBorrows', '正在借阅'], ['overdueBorrows', '逾期借阅'], ['returnedTotal', '累计归还'],
  ['readerCount', '读者人数'], ['roomToday', '今日活动室预约'], ['roomUpcoming', '待使用 / 待签退'],
  ['pendingReviews', '待审核书评'], ['approvedReviews', '已发布书评']
];
const SLOT_LABELS = { free: '可预约', booked: '已占用', closed: '未开放', past: '已过时' };
function slotView(range, calendar, date) {
  const day = range.days.find(item => item.date === date) || range.days[0];
  if (!day) return { selectedDate: '', slotOptions: [], dayBookings: [], daySlots: [] };
  const occupancy = calendar.days.find(item => item.date === day.date) || { slots: [], bookings: [] };
  return {
    selectedDate: day.date,
    openSlots: day.openSlots,
    slotOptions: range.allSlots.map(time => ({ time, checked: day.openSlots.indexOf(time) !== -1 })),
    daySlots: occupancy.slots.map(slot => Object.assign({}, slot, { label: SLOT_LABELS[slot.status] || slot.status })),
    dayBookings: ui.records(occupancy.bookings)
  };
}
Page({
  data: {
    me: null, checking: true, busy: false, loading: false, error: '',
    form: { username: '', password: '' }, panels: PANELS, panel: 'dashboard',
    search: '', status: 'all', filters: [], items: [], stats: [], popularBooks: [],
    rejectId: '', rejectReason: '', slotDays: [], selectedDate: '', openSlots: [],
    slotOptions: [], daySlots: [], dayBookings: [], applyToRange: false,
    startDate: '', endDate: '', material: null
  },
  input: ui.formInput,
  preview: ui.preview,
  async onShow() {
    this.setData({ checking: true, error: '' });
    try {
      const me = await api.request('/api/admin/me');
      this.setData({ me });
      await this.load();
    } catch (error) { this.handleError(error); }
    finally { this.setData({ checking: false }); }
  },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  handleError(error) {
    if (error.status === 401) {
      this.sequence = (this.sequence || 0) + 1;
      this.setData({ me: null, loading: false, items: [], stats: [], slotDays: [], material: null, error: '请登录管理员账号' });
    } else { this.setData({ error: error.message || '加载失败，请重试' }); }
  },
  login() {
    return ui.run(this, async () => {
      if (!this.data.form.username.trim() || !this.data.form.password) throw new Error('请填写用户名和密码');
      const me = await api.request('/api/admin/login', 'POST', { username: this.data.form.username.trim(), password: this.data.form.password });
      this.setData({ me, 'form.password': '', error: '', panel: 'dashboard' });
      await this.load();
    });
  },
  logout() {
    return ui.run(this, async () => {
      try { await api.request('/api/admin/logout', 'POST'); }
      finally {
        api.clearSession();
        this.sequence = (this.sequence || 0) + 1;
        this.setData({ me: null, items: [], stats: [], popularBooks: [], slotDays: [], dayBookings: [], material: null, rejectId: '', 'form.password': '', error: '' });
      }
    });
  },
  changePanel(event) {
    if (this.data.busy) return;
    const panel = event.currentTarget.dataset.value;
    if (!PANELS.some(item => item.value === panel)) return;
    this.setData({ panel, status: panel === 'reviews' ? 'pending' : 'all', filters: FILTERS[panel] || [], search: '', items: [], error: '', material: null, rejectId: '' });
    this.load();
  },
  searchInput(event) { this.setData({ search: event.detail.value }); },
  changeFilter(event) {
    if (this.data.busy) return;
    this.setData({ status: event.currentTarget.dataset.value });
    this.load();
  },
  async load() {
    if (!this.data.me) return;
    const sequence = this.sequence = (this.sequence || 0) + 1;
    const panel = this.data.panel;
    this.setData({ loading: true, error: '' });
    try {
      let patch;
      if (panel === 'dashboard') {
        const stats = await api.request('/api/admin/stats');
        patch = { stats: STAT_LABELS.map(([key, label]) => ({ key, label, value: stats[key] || 0, attention: (key === 'overdueBorrows' || key === 'pendingReviews') && stats[key] > 0 })), popularBooks: stats.popularBooks || [] };
      } else if (panel === 'slots') {
        const [range, calendar] = await Promise.all([api.request('/api/admin/room/slots'), api.request('/api/admin/room/calendar')]);
        if (sequence !== this.sequence) return;
        this.slotRange = range;
        this.calendar = calendar;
        patch = Object.assign({ slotDays: range.days, startDate: calendar.startDate, endDate: calendar.endDate }, slotView(range, calendar, this.data.selectedDate));
      } else {
        const resource = panel === 'rooms' ? 'room/bookings' : panel;
        const items = await api.request('/api/admin/' + resource, 'GET', { status: this.data.status, search: this.data.search.trim() });
        patch = { items: panel === 'books' ? items : ui.records(items) };
      }
      if (sequence === this.sequence) this.setData(patch);
    } catch (error) { if (sequence === this.sequence) this.handleError(error); }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  addBook() { wx.navigateTo({ url: '/pages/admin-book/index' }); },
  editBook(event) { wx.navigateTo({ url: '/pages/admin-book/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  act(event) {
    const id = event.currentTarget.dataset.id;
    const action = event.currentTarget.dataset.action;
    const actions = {
      removeBook: { path: 'books/' + id, method: 'DELETE', text: '删除这本图书？有借阅记录的图书将由系统保护。', done: '图书已删除' },
      returnBorrow: { path: 'borrows/' + id + '/return', method: 'POST', text: '确认已经收到归还的图书？', done: '归还已确认' },
      approve: { path: 'reviews/' + id + '/approve', method: 'POST', text: '审核通过后，这条书评将对读者公开。确认通过？', done: '书评已通过' },
      removeReview: { path: 'reviews/' + id, method: 'DELETE', text: '确认删除这条书评？删除后无法恢复。', done: '书评已删除' },
      cancelRoom: { path: 'room/bookings/' + id + '/cancel', method: 'POST', text: '确认取消这条活动室预约并释放时段？', done: '预约已取消' }
    };
    const selected = actions[action];
    if (!selected || !id) return;
    return ui.run(this, async () => {
      if (!(await ui.confirm(selected.text))) return;
      try {
        await api.request('/api/admin/' + selected.path, selected.method);
        ui.success(selected.done);
        await this.load();
      } catch (error) { this.handleError(error); throw error; }
    });
  },
  openReject(event) { this.setData({ rejectId: event.currentTarget.dataset.id, rejectReason: '' }); },
  rejectInput(event) { this.setData({ rejectReason: event.detail.value }); },
  closeReject() { this.setData({ rejectId: '', rejectReason: '' }); },
  rejectReview() {
    return ui.run(this, async () => {
      const reason = this.data.rejectReason.trim();
      if (!reason) throw new Error('请填写修改建议或未通过原因');
      try {
        await api.request('/api/admin/reviews/' + this.data.rejectId + '/reject', 'POST', { reason });
        this.closeReject();
        ui.success('已退回修改');
        await this.load();
      } catch (error) { this.handleError(error); throw error; }
    });
  },
  chooseDate(event) {
    if (this.data.busy || !this.slotRange) return;
    const date = event.detail.value || event.currentTarget.dataset.date;
    this.setData(slotView(this.slotRange, this.calendar, date));
  },
  changeSlots(event) {
    const openSlots = event.detail.value;
    this.setData({ openSlots, slotOptions: this.data.slotOptions.map(item => ({ time: item.time, checked: openSlots.indexOf(item.time) !== -1 })) });
  },
  rangeChange(event) { this.setData({ applyToRange: event.detail.value }); },
  saveSlots() {
    return ui.run(this, async () => {
      if (!this.data.selectedDate) throw new Error('请先选择日期');
      const scope = this.data.applyToRange ? '全部可预约日期（' + this.data.startDate + ' 至 ' + this.data.endDate + '）' : this.data.selectedDate;
      if (!(await ui.confirm('将 ' + scope + ' 的开放时段设置为 ' + this.data.openSlots.length + ' 个。已有预约会保留，确认保存？'))) return;
      try {
        await api.request('/api/admin/room/slots', 'PUT', { date: this.data.selectedDate, openSlots: this.data.openSlots, applyToRange: this.data.applyToRange });
        ui.success('开放时段已保存');
        await this.load();
      } catch (error) { this.handleError(error); throw error; }
    });
  },
  openMaterial(event) {
    const item = this.data.items.find(record => record.id === event.currentTarget.dataset.id);
    if (item) this.setData({ material: Object.assign({}, item, { imageUrl: api.asset(item.volunteerImage) }) });
  },
  closeMaterial() { this.setData({ material: null }); }
});
