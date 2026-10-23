// Built-in item definitions of the web game (snug/src/data/items.js ITEM_DEFS + MYSTERY), kept
// verbatim as data. The web game starts from this table and lets every loaded manifest override
// shape (collider) and meta; items 53+ exist only through their manifest. ItemCatalog does the same,
// so defs (and therefore areas, difficulty) are identical even if a manifest lacks a collider.
import type { ItemDef } from './types';

/** Fresh copy of the built-in table (callers may mutate the defs) */
export function createLegacyItemDefs(): ItemDef[] {
  return JSON.parse(JSON.stringify(LEGACY_ITEM_DEFS));
}
/** Fresh copy of the mystery box def (id -1) */
export function createMysteryDef(): ItemDef {
  return JSON.parse(JSON.stringify(MYSTERY_DEF));
}

const LEGACY_ITEM_DEFS: ItemDef[] = [
  {"id":1,"slug":"tshirt","code":"ITM_001","name":"Áo phông gấp","kind":"rect","w":84,"h":60,"chamfer":8,"box":[-42,-30,42,30],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":2,"slug":"shorts","code":"ITM_002","name":"Quần short gấp","kind":"rect","w":80,"h":58,"chamfer":8,"box":[-40,-29,40,29],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":3,"slug":"socks","code":"ITM_003","name":"Tất cuộn","kind":"circle","r":27,"box":[-27,-27,27,27],"meta":{"size":"Small","shape":"Oval","physics":"rolling","cost":2,"canLink":true,"canLock":true}},
  {"id":4,"slug":"sneaker","code":"ITM_004","name":"Giày thể thao","kind":"poly","pts":[[-44,8],[-38,-6],[-10,-14],[6,-26],[22,-26],[30,-8],[44,4],[44,20],[-44,20]],"box":[-44,-26,44,20],"meta":{"size":"Medium","shape":"L-shape","physics":"normal","cost":2,"canLink":true,"canLock":false}},
  {"id":5,"slug":"raincoat","code":"ITM_005","name":"Áo mưa gấp","kind":"rect","w":86,"h":62,"chamfer":6,"box":[-43,-31,43,31],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":6,"slug":"tissue","code":"ITM_006","name":"Gói giấy ăn","kind":"rect","w":56,"h":42,"chamfer":10,"box":[-28,-21,28,21],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":7,"slug":"sanitizer","code":"ITM_007","name":"Nước rửa tay","kind":"rect","w":34,"h":66,"chamfer":12,"box":[-17,-45,17,33],"extra":{"kind":"rect","w":16,"h":14,"dx":0,"dy":-40},"meta":{"size":"Small","shape":"Rounded rect","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":8,"slug":"handtowel","code":"ITM_008","name":"Khăn tay","kind":"rect","w":58,"h":40,"chamfer":5,"box":[-29,-20,29,20],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":9,"slug":"lipbalm","code":"ITM_009","name":"Son dưỡng môi","kind":"rect","w":20,"h":76,"chamfer":9,"box":[-10,-38,10,38],"meta":{"size":"Small","shape":"Long","physics":"rolling","cost":2,"canLink":true,"canLock":true}},
  {"id":10,"slug":"wetwipes","code":"ITM_010","name":"Khăn ướt","kind":"rect","w":60,"h":40,"chamfer":8,"box":[-30,-20,30,20],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":11,"slug":"tablet","code":"ITM_011","name":"Máy tính bảng","kind":"rect","w":112,"h":80,"chamfer":7,"box":[-56,-40,56,40],"meta":{"size":"Large","shape":"Rectangle","physics":"normal","cost":3,"canLink":false,"canLock":true}},
  {"id":12,"slug":"calculator","code":"ITM_012","name":"Máy tính bỏ túi","kind":"rect","w":44,"h":54,"chamfer":5,"box":[-22,-27,22,27],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":13,"slug":"earbuds","code":"ITM_013","name":"Hộp tai nghe","kind":"circle","r":25,"box":[-25,-25,25,25],"meta":{"size":"Small","shape":"Oval","physics":"rolling","cost":2,"canLink":true,"canLock":true}},
  {"id":14,"slug":"charger","code":"ITM_014","name":"Củ sạc","kind":"rect","w":46,"h":48,"chamfer":9,"box":[-23,-24,23,24],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":15,"slug":"waterbottle","code":"ITM_015","name":"Bình nước","kind":"rect","w":32,"h":100,"chamfer":12,"box":[-16,-64,16,50],"extra":{"kind":"rect","w":18,"h":18,"dx":0,"dy":-57},"meta":{"size":"Medium","shape":"Long","physics":"rolling","cost":2,"canLink":true,"canLock":true}},
  {"id":16,"slug":"sandwich","code":"ITM_016","name":"Hộp bánh mì kẹp","kind":"poly","pts":[[-54,30],[54,30],[0,-46]],"box":[-54,-46,54,30],"meta":{"size":"Medium","shape":"Triangle","physics":"normal","cost":2,"canLink":true,"canLock":true}},
  {"id":17,"slug":"apple","code":"ITM_017","name":"Quả táo","kind":"circle","r":27,"box":[-27,-38,27,27],"meta":{"size":"Small","shape":"Circle","physics":"rolling","cost":2,"canLink":true,"canLock":false}},
  {"id":18,"slug":"banana","code":"ITM_018","name":"Quả chuối","kind":"poly","pts":[[-36,-6],[-22,-18],[0,-22],[22,-14],[34,4],[26,14],[4,6],[-18,8],[-34,6]],"box":[-36,-22,34,14],"meta":{"size":"Small","shape":"Curved","physics":"rolling","cost":2,"canLink":true,"canLock":false}},
  {"id":19,"slug":"milk","code":"ITM_019","name":"Hộp sữa","kind":"poly","pts":[[-22,-20],[22,-20],[22,32],[-22,32]],"extra":{"kind":"poly","pts":[[-22,-20],[22,-20],[10,-34],[-10,-34]]},"box":[-22,-34,22,32],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":20,"slug":"granola","code":"ITM_020","name":"Thanh ngũ cốc","kind":"rect","w":62,"h":36,"chamfer":6,"box":[-31,-18,31,18],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":21,"slug":"cap","code":"ITM_021","name":"Mũ lưỡi trai","kind":"compound","parts":[{"kind":"circle","r":30,"dx":-6,"dy":-4},{"kind":"rect","w":54,"h":16,"dx":32,"dy":18,"chamfer":8}],"box":[-38,-36,62,28],"meta":{"size":"Medium","shape":"Irregular","physics":"normal","cost":2,"canLink":true,"canLock":false}},
  {"id":22,"slug":"umbrella","code":"ITM_022","name":"Ô gấp","kind":"rect","w":30,"h":104,"chamfer":14,"box":[-15,-52,15,70],"extra":{"kind":"rect","w":14,"h":22,"dx":0,"dy":60},"meta":{"size":"Medium","shape":"Long","physics":"rolling","cost":2,"canLink":true,"canLock":true}},
  {"id":23,"slug":"keyring","code":"ITM_023","name":"Móc chìa khóa","kind":"compound","parts":[{"kind":"circle","r":15,"dx":-14,"dy":0},{"kind":"rect","w":26,"h":12,"dx":12,"dy":6,"chamfer":5}],"box":[-31,-19,27,19],"meta":{"size":"Small","shape":"Irregular","physics":"normal","cost":1,"canLink":true,"canLock":false}},
  {"id":24,"slug":"studentcard","code":"ITM_024","name":"Thẻ học sinh","kind":"rect","w":62,"h":40,"chamfer":5,"box":[-31,-20,31,20],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":25,"slug":"notebook","code":"ITM_025","name":"Vở ghi","kind":"rect","w":74,"h":68,"chamfer":3,"box":[-37,-34,37,34],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":26,"slug":"textbook","code":"ITM_026","name":"Sách giáo khoa","kind":"rect","w":104,"h":86,"chamfer":3,"box":[-52,-43,52,43],"meta":{"size":"Large","shape":"Rectangle","physics":"normal","cost":3,"canLink":false,"canLock":true}},
  {"id":27,"slug":"ruler","code":"ITM_027","name":"Thước kẻ","kind":"rect","w":18,"h":96,"chamfer":3,"box":[-9,-48,9,48],"meta":{"size":"Small","shape":"Long","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":28,"slug":"pencil","code":"ITM_028","name":"Bút chì","kind":"poly","pts":[[-7,-40],[7,-40],[7,32],[0,46],[-7,32]],"box":[-7,-40,7,46],"meta":{"size":"Small","shape":"Long","physics":"rolling","cost":1,"canLink":true,"canLock":true}},
  {"id":29,"slug":"gluestick","code":"ITM_029","name":"Keo dán","kind":"rect","w":22,"h":70,"chamfer":8,"box":[-11,-35,11,35],"meta":{"size":"Small","shape":"Long","physics":"rolling","cost":1,"canLink":true,"canLock":true}},
  {"id":30,"slug":"paintbox","code":"ITM_030","name":"Hộp màu nước","kind":"rect","w":96,"h":54,"chamfer":6,"box":[-48,-27,48,27],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":2,"canLink":true,"canLock":true}},
  {"id":31,"slug":"jacket","code":"ITM_031","name":"Áo khoác gấp","kind":"rect","w":108,"h":80,"chamfer":8,"box":[-54,-40,54,40],"meta":{"size":"Large","shape":"Rectangle","physics":"normal","cost":3,"canLink":true,"canLock":true}},
  {"id":32,"slug":"pajamas","code":"ITM_032","name":"Bộ ngủ gấp","kind":"rect","w":82,"h":60,"chamfer":8,"box":[-41,-30,41,30],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":33,"slug":"toothbrush","code":"ITM_033","name":"Bàn chải","kind":"rect","w":16,"h":76,"chamfer":6,"box":[-11,-38,11,38],"meta":{"size":"Small","shape":"Long","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":34,"slug":"toothpaste","code":"ITM_034","name":"Kem đánh răng","kind":"rect","w":22,"h":66,"chamfer":7,"box":[-11,-33,11,33],"meta":{"size":"Small","shape":"Long","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":35,"slug":"shampoo","code":"ITM_035","name":"Chai dầu gội","kind":"rect","w":34,"h":64,"chamfer":12,"box":[-17,-32,17,32],"meta":{"size":"Small","shape":"Rounded rect","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":36,"slug":"hairbrush","code":"ITM_036","name":"Lược chải","kind":"poly","pts":[[-14,-34],[14,-34],[18,-10],[14,14],[6,34],[-6,34],[-14,14],[-18,-10]],"box":[-18,-34,18,34],"meta":{"size":"Medium","shape":"Irregular","physics":"normal","cost":2,"canLink":true,"canLock":true}},
  {"id":37,"slug":"deodorant","code":"ITM_037","name":"Lăn khử mùi","kind":"rect","w":30,"h":58,"chamfer":12,"box":[-15,-29,15,29],"meta":{"size":"Small","shape":"Rounded rect","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":38,"slug":"smartphone","code":"ITM_038","name":"Điện thoại","kind":"rect","w":38,"h":72,"chamfer":8,"box":[-19,-36,19,36],"meta":{"size":"Small","shape":"Rectangle","physics":"vibrating","cost":2,"canLink":true,"canLock":true}},
  {"id":39,"slug":"camera","code":"ITM_039","name":"Máy ảnh nhỏ","kind":"poly","pts":[[-34,-12],[-20,-24],[16,-24],[34,-12],[34,20],[-34,20]],"box":[-34,-30,34,20],"meta":{"size":"Medium","shape":"Irregular","physics":"normal","cost":2,"canLink":true,"canLock":true}},
  {"id":40,"slug":"powerbank","code":"ITM_040","name":"Pin dự phòng","kind":"rect","w":44,"h":52,"chamfer":7,"box":[-22,-26,22,26],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":41,"slug":"cable","code":"ITM_041","name":"Dây sạc cuộn","kind":"circle","r":24,"box":[-24,-24,24,24],"meta":{"size":"Small","shape":"Circle","physics":"rolling","cost":1,"canLink":true,"canLock":true}},
  {"id":42,"slug":"crackers","code":"ITM_042","name":"Gói bánh quy","kind":"rect","w":60,"h":40,"chamfer":6,"box":[-30,-20,30,20],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":43,"slug":"juice","code":"ITM_043","name":"Hộp nước ép","kind":"rect","w":36,"h":62,"chamfer":4,"box":[-18,-31,18,36],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":44,"slug":"sunglasses","code":"ITM_044","name":"Kính râm","kind":"poly","pts":[[-38,-12],[38,-12],[38,2],[22,14],[8,4],[-8,4],[-22,14],[-38,2]],"box":[-38,-14,38,14],"meta":{"size":"Small","shape":"Irregular","physics":"normal","cost":2,"canLink":true,"canLock":false}},
  {"id":45,"slug":"wallet","code":"ITM_045","name":"Ví tiền","kind":"rect","w":58,"h":42,"chamfer":6,"box":[-29,-21,29,21],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":46,"slug":"sleepmask","code":"ITM_046","name":"Bịt mắt ngủ","kind":"poly","pts":[[-34,-12],[-14,-18],[14,-18],[34,-12],[34,8],[14,16],[-14,16],[-34,8]],"box":[-34,-18,34,16],"meta":{"size":"Small","shape":"Curved","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":47,"slug":"neckpillow","code":"ITM_047","name":"Gối cổ","kind":"compound","parts":[{"kind":"rect","w":26,"h":62,"dx":-30,"dy":4,"chamfer":12},{"kind":"rect","w":26,"h":62,"dx":30,"dy":4,"chamfer":12},{"kind":"rect","w":86,"h":30,"dx":0,"dy":-20,"chamfer":14}],"box":[-43,-35,43,35],"meta":{"size":"Large","shape":"U-shape","physics":"normal","cost":3,"canLink":true,"canLock":false}},
  {"id":48,"slug":"guidebook","code":"ITM_048","name":"Sách hướng dẫn","kind":"rect","w":64,"h":86,"chamfer":4,"box":[-32,-43,32,43],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":2,"canLink":true,"canLock":true}},
  {"id":49,"slug":"map","code":"ITM_049","name":"Bản đồ gấp","kind":"rect","w":62,"h":44,"chamfer":3,"box":[-31,-22,31,22],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":50,"slug":"ticket","code":"ITM_050","name":"Vé tàu xe","kind":"rect","w":56,"h":30,"chamfer":3,"box":[-28,-15,28,15],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":51,"slug":"cards","code":"ITM_051","name":"Bộ bài","kind":"rect","w":40,"h":56,"chamfer":4,"box":[-20,-28,20,28],"meta":{"size":"Small","shape":"Rectangle","physics":"normal","cost":1,"canLink":true,"canLock":true}},
  {"id":52,"slug":"travelmug","code":"ITM_052","name":"Cốc giữ nhiệt","kind":"poly","pts":[[-20,-36],[20,-36],[24,0],[20,36],[-20,36],[-24,0]],"box":[-30,-36,30,36],"meta":{"size":"Medium","shape":"Irregular","physics":"normal","cost":2,"canLink":true,"canLock":true}},
  {"id":0,"slug":"key","code":null,"name":"Chìa khóa","kind":"compound","parts":[{"kind":"circle","r":11,"dx":-16,"dy":0},{"kind":"rect","w":34,"h":8,"dx":8,"dy":0,"chamfer":3}],"box":[-29,-13,27,13],"meta":{"size":"Small","shape":"Irregular","physics":"normal","cost":0,"canLink":false,"canLock":false}},
];

const MYSTERY_DEF: ItemDef = {"id":-1,"slug":"mystery","code":null,"name":"Hộp bí ẩn","kind":"rect","w":62,"h":62,"chamfer":9,"box":[-31,-31,31,31],"meta":{"size":"Medium","shape":"Rectangle","physics":"normal","cost":2,"canLink":false,"canLock":false}};
