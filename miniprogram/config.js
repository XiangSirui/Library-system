// AppID 在仓库根目录 project.config.json 中设置。
// 将 trial / release 填为自己的 HTTPS 服务域名，不要填写 AppSecret。
const environments = {
  develop: 'http://127.0.0.1:5000',
  trial: '',
  release: ''
};
function environment() {
  try { return wx.getAccountInfoSync().miniProgram.envVersion || 'develop'; }
  catch (error) { return 'develop'; }
}
function baseUrl() {
  const env = environment();
  const url = String(environments[env] || '').replace(/\/+$/, '');
  if (!url) throw new Error('服务尚未配置，请联系空间管理员');
  if (env !== 'develop' && !/^https:\/\//.test(url)) throw new Error('服务地址需要使用 HTTPS');
  if (isLocal(url) && platform() && platform() !== 'devtools') throw new Error('真机无法访问电脑的本地服务，请在 config.js 中配置可访问的 HTTPS 测试域名');
  return url;
}
function isLocal(url) { return /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url); }
function platform() {
  try { return (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()).platform || ''; }
  catch (error) { return ''; }
}
module.exports = { baseUrl, environment, isLocal };
