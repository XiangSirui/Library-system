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
    this.setData({ sections, map: url('/static/images/garden/garden-plan.jpg'), hero: url('/static/images/garden/build/figure20.jpg'), error: api.asset('/') ? '' : '花园照片将在服务配置完成后显示' });
  },
  retryPhotos() { this.loadPhotos(true); },
  imageError() { if (!this.data.error) this.setData({ error: '部分照片暂时无法加载，请检查网络后重试' }); },
  preview(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    const urls = [this.data.map].concat(...this.data.sections.map(section => section.photos.map(photo => photo.url))).filter(Boolean);
    wx.previewImage({ current: url, urls });
  },
  scroll(event) { wx.pageScrollTo({ selector: '#' + event.currentTarget.dataset.target, duration: 300 }); },
  books() { wx.switchTab({ url: '/pages/books/index' }); },
  room() { wx.switchTab({ url: '/pages/room/index' }); },
  onShareAppMessage() { return { title: '阅享空间 · 一座由居民共同创造的花园', path: '/pages/garden/index' }; }
});
