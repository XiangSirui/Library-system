const api = require('../../utils/api');
const content = require('../../data/garden');
Page({
  data: { sections: [], map: '', hero: '', places: ['休憩廊架', '儿童活动区', '户外社区课堂', '雨水花园', '蜜源花园', '昆虫旅馆', '资源花园', '生态教育箱', '社区图书馆'], error: '' },
  onLoad() { this.loadPhotos(false); },
  onPullDownRefresh() { this.loadPhotos(true); wx.stopPullDownRefresh(); },
  loadPhotos(retry) {
    const version = retry ? '?v=' + Date.now() : '';
    const url = path => { const value = api.asset(path); return value ? value + version : ''; };
    const sections = content.map(section => Object.assign({}, section, { photos: section.photos.map(photo => Object.assign({}, photo, { url: url(photo.path) })) }));
    this.setData({ sections, map: url('/static/images/garden/garden-plan.jpg'), hero: url('/static/images/garden/build/figure20.jpg'), error: api.asset('/') ? '' : api.connectionError().message });
  },
  retryPhotos() { this.loadPhotos(true); },
  imageError(event) { if (!this.data.error) this.setData({ error: api.connectionError(event && event.detail, '照片加载失败').message }); },
  preview(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    const urls = [this.data.map].concat(...this.data.sections.map(section => section.photos.map(photo => photo.url))).filter(Boolean);
    wx.previewImage({ current: url, urls });
  },
  scroll(event) { wx.pageScrollTo({ selector: '#' + event.currentTarget.dataset.target, duration: 300 }); },
  books() { wx.switchTab({ url: '/pages/books/index' }); },
  room() { wx.switchTab({ url: '/pages/room/index' }); },
  onShareAppMessage() { return { title: '科育邻里 · 一座由居民共同创造的花园', path: '/pages/garden/index' }; }
});
