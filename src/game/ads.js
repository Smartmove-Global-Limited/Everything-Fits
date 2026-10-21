// Quảng cáo có thưởng (rewarded ad).
//
// TẠM THỜI: game chưa gắn SDK quảng cáo. Hàm dưới chỉ GIẢ LẬP một lượt xem: phủ một tấm màn
// "Ad playing…" đếm ngược vài giây, xem hết thì trả true. Có nút đóng sớm: đóng sớm trả false,
// đúng như tài liệu (đóng sớm / quảng cáo lỗi thì không nhận thưởng).
// Gắn SDK thật (AdMob, AppLovin…) thì chỉ thay thân hàm xemQuangCao, nơi gọi giữ nguyên.
const DAI = 2500;   // mili giây một lượt xem giả lập

let dangXem = null;

/** Có quảng cáo để xem không. SDK thật trả false khi chưa nạp xong / mất mạng. */
export const coQuangCao = () => true;

/**
 * Xem một quảng cáo có thưởng. Trả về Promise<boolean>: true khi xem đủ, false khi đóng sớm
 * hoặc lỗi. Đang xem dở mà gọi thêm thì trả về đúng lượt đang xem, không mở chồng.
 */
export function xemQuangCao() {
  if (dangXem) return dangXem;
  const el = document.getElementById('adSim');
  if (!el) return Promise.resolve(false);
  const dem = el.querySelector('b'), dong = el.querySelector('button');
  dangXem = new Promise(xong => {
    const het = performance.now() + DAI;
    el.classList.add('show');
    const chay = setInterval(() => {
      const con = Math.ceil((het - performance.now()) / 1000);
      dem.textContent = Math.max(0, con);
      if (con <= 0) ket(true);
    }, 100);
    const boQua = () => ket(false);
    dong.addEventListener('click', boQua, { once: true });
    function ket(du) {
      clearInterval(chay);
      dong.removeEventListener('click', boQua);
      el.classList.remove('show');
      dangXem = null;
      xong(du);
    }
  });
  return dangXem;
}
