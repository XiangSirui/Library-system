const api = require('../../utils/api');
Page({
  data: { books: [], categories: ['全部', '文学', '科幻', '历史', '少儿', '社科', '艺术'], category: '全部', search: '', loading: false, error: '' },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load().finally(() => wx.stopPullDownRefresh()); },
  searchInput(event) { this.setData({ search: event.detail.value }); },
  filter(event) { this.setData({ category: event.currentTarget.dataset.value }); this.load(); },
  async load() {
    const sequence = this.sequence = (this.sequence || 0) + 1;
    this.setData({ loading: true, error: '' });
    try {
      const books = await api.request('/api/books', 'GET', { category: this.data.category === '全部' ? 'all' : this.data.category, search: this.data.search.trim() });
      if (sequence === this.sequence) this.setData({ books });
    } catch (error) { if (sequence === this.sequence) this.setData({ error: error.message }); }
    finally { if (sequence === this.sequence) this.setData({ loading: false }); }
  },
  openBook(event) { wx.navigateTo({ url: '/pages/book/index?id=' + encodeURIComponent(event.currentTarget.dataset.id) }); },
  onShareAppMessage() { return { title: '科育邻里 · 把一本好书带回家', path: '/pages/books/index' }; }
});
