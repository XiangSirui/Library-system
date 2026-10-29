const api = require('../../utils/api');
const ui = require('../../utils/ui');
Page({
  data: { book: null, form: { name: '', phone: '', content: '', rating: 5 }, ratings: [1, 2, 3, 4, 5], accepted: false, busy: false, loading: false, error: '', editing: false, eligibility: null },
  onLoad(options) {
    this.bookId = options.bookId || ''; this.reviewId = options.id || '';
    this.setData({ form: Object.assign({}, ui.profile(), { content: '', rating: 5 }), editing: !!this.reviewId });
    this.load();
  },
  input(event) { ui.formInput.call(this, event); if (event.currentTarget.dataset.field === 'phone') this.setData({ eligibility: null }); },
  consent: ui.consent, privacy: ui.privacy,
  rating(event) { this.setData({ 'form.rating': Number(event.currentTarget.dataset.value) }); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      if (this.reviewId) {
        const phone = this.data.form.phone;
        if (!/^\d{11}$/.test(phone)) throw new Error('请先在「我的」查询记录后再编辑书评');
        const mine = await api.request('/api/reviews/mine', 'GET', { phone });
        const review = mine.find(item => item.id === this.reviewId);
        if (!review) throw new Error('未找到这篇书评，请返回我的记录重新选择');
        this.bookId = review.bookId;
        this.setData({ form: { name: review.name, phone, content: review.content, rating: review.rating } });
      }
      const book = await api.request('/api/books/' + encodeURIComponent(this.bookId));
      this.setData({ book });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  submit() {
    return ui.run(this, async () => {
      const form = Object.assign({}, this.data.form, { name: this.data.form.name.trim(), phone: this.data.form.phone.trim(), content: this.data.form.content.trim() });
      ui.validateContact(form); ui.requireConsent(this.data.accepted);
      if (form.content.length < 10 || form.content.length > 500) throw new Error('读后感请填写 10–500 个字');
      const eligibility = await api.request('/api/reviews/eligibility', 'GET', { book_id: this.bookId, phone: form.phone });
      this.setData({ eligibility });
      if (!eligibility.canReview) throw new Error(eligibility.reason);
      await api.request(this.reviewId ? '/api/reviews/' + encodeURIComponent(this.reviewId) : '/api/reviews', this.reviewId ? 'PUT' : 'POST', Object.assign({ bookId: this.bookId }, form));
      ui.saveProfile(Object.assign({}, ui.profile(), { name: form.name, phone: form.phone }));
      wx.showModal({ title: '已提交审核', content: '审核通过后会公开展示。你可以在「我的」查看状态和修改书评。', showCancel: false, success() { wx.navigateBack(); } });
    });
  }
});
