// Thông báo ngắn nổi giữa màn, dùng chung cho Main Menu, Shop và các popup
// ("Not enough gold", "Ad unavailable…"). Trong ván chơi vẫn dùng toast của hud.js.
let hen = 0;
export function efToast(text, ms = 1600) {
  const el = document.getElementById('efToast'); if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(hen);
  hen = setTimeout(() => el.classList.remove('show'), ms);
}
