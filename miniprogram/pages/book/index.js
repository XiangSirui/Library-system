const api = require('../../utils/api');
const ui = require('../../utils/ui');
Page({
  data: { book: null, reviews: [], reviewCount: 0, avgRating: 0, form: { name: '', phone: '', card: '' }, accepted: false, busy: false, loading: false, error: '' },
  onLoad(options) { this.bookId = options.id || ''; this.setData({ form: ui.profile() }); },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  input: ui.formInput, consent: ui.consent, privacy: ui.privacy,
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const results = await Promise.all([api.request('/api/books/' + encodeURIComponent(this.bookId)), api.request('/api/books/' + encodeURIComponent(this.bookId) + '/reviews')]);
      this.setData({ book: results[0], reviews: results[1].reviews, reviewCount: results[1].count, avgRating: results[1].avgRating });
      wx.setNavigationBarTitle({ title: results[0].title });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  borrow() {
    return ui.run(this, async () => {
      const form = Object.assign({}, this.data.form, { name: this.data.form.name.trim(), phone: this.data.form.phone.trim() });
      ui.validateContact(form); ui.requireConsent(this.data.accepted);
      await api.login();
      const record = await api.request('/api/borrows', 'POST', Object.assign({ bookId: this.bookId }, form));
      ui.saveProfile(form);
      await this.load();
      wx.showModal({ title: '借阅成功', content: '取书码：' + record.code + '\n应还日期：' + record.dueDate + '\n请到馆出示取书码领取图书，可在「我的」查看。', showCancel: false, confirmText: '知道了', confirmColor: '#315e46' });
    });
  },
  writeReview() {
    if (this.data.accepted) ui.saveProfile(this.data.form);
    wx.navigateTo({ url: '/pages/review/index?bookId=' + encodeURIComponent(this.bookId) });
  },
  mine() { wx.switchTab({ url: '/pages/mine/index' }); }
});
