const api = require('../../utils/api');
const ui = require('../../utils/ui');
Page({
  data: {
    id: '', busy: false, loading: true, authenticated: false, error: '', borrowed: 0,
    categories: ['文学', '科幻', '历史', '少儿', '社科', '艺术'], categoryIndex: 0,
    form: { title: '', author: '', category: '文学', isbn: '', copies: '1', coverIsbn: '' }
  },
  input: ui.formInput,
  onLoad(options) {
    this.setData({ id: options.id || '' });
    wx.setNavigationBarTitle({ title: options.id ? '编辑图书' : '添加图书' });
    this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      await api.request('/api/admin/me');
      this.setData({ authenticated: true });
      if (this.data.id) {
        const book = await api.request('/api/books/' + encodeURIComponent(this.data.id));
        const categories = this.data.categories.slice();
        if (categories.indexOf(book.category) === -1) categories.push(book.category);
        this.setData({
          form: { title: book.title, author: book.author, category: book.category, isbn: book.isbn || '', copies: String(book.copies), coverIsbn: book.coverIsbn || '' },
          borrowed: book.borrowed, categories, categoryIndex: categories.indexOf(book.category)
        });
      }
    } catch (error) {
      this.setData({ authenticated: error.status === 401 ? false : this.data.authenticated, error: error.status === 401 ? '登录已失效，请返回管理页重新登录' : error.message });
    } finally { this.setData({ loading: false }); }
  },
  categoryChange(event) {
    const index = Number(event.detail.value);
    this.setData({ categoryIndex: index, 'form.category': this.data.categories[index] });
  },
  back() { wx.navigateBack(); },
  save() {
    return ui.run(this, async () => {
      if (!this.data.authenticated || this.data.loading || this.data.error) throw new Error('请先完成页面加载并登录管理员账号');
      const form = Object.assign({}, this.data.form);
      ['title', 'author', 'category', 'isbn', 'coverIsbn'].forEach(key => { form[key] = String(form[key] || '').trim(); });
      if (!form.title || !form.author || !form.category) throw new Error('请填写书名、作者和分类');
      const copiesText = String(form.copies).trim();
      if (!/^\d+$/.test(copiesText)) throw new Error('馆藏册数须为正整数');
      form.copies = Number(copiesText);
      if (!Number.isSafeInteger(form.copies) || form.copies < 1) throw new Error('馆藏册数至少为 1');
      if (form.copies < this.data.borrowed) throw new Error('馆藏册数不能少于已借出的 ' + this.data.borrowed + ' 本');
      try {
        await api.request('/api/admin/books' + (this.data.id ? '/' + encodeURIComponent(this.data.id) : ''), this.data.id ? 'PUT' : 'POST', form);
        ui.success(this.data.id ? '图书已更新' : '图书已添加');
        wx.navigateBack();
      } catch (error) {
        if (error.status === 401) this.setData({ authenticated: false, error: '登录已失效，请返回管理页重新登录' });
        throw error;
      }
    });
  }
});
