// app.js（module）が動かなかったときだけ、起動方法の案内を出す（file:// 直開きなど）
setTimeout(function () {
  if (!window.__kotaroReady) {
    var el = document.getElementById('load-warning');
    if (el) el.hidden = false;
  }
}, 2000);
