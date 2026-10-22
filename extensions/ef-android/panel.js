'use strict';
// EF Android panel (menu Extension → EF Android): the fields of Android Studio's "Generate Signed
// App Bundle" dialog plus the version, and two buttons:
//   Build debug ra máy     debug key, installed over the app put on the phone by Android Studio
//   Build release up chợ   AAB + APK signed with the key store below, for Google Play
// The work is done by main.js (saves the fields, queues the Cocos build) and hooks.js (packing).
const MODE_TITLE = { device: 'Build debug ra máy', store: 'Build release up chợ' };

module.exports = Editor.Panel.define({
  template: `
    <div class="ef">
      <h2>Phiên bản</h2>
      <ui-prop><ui-label slot="label" value="Version code"></ui-label><ui-num-input slot="content" id="versionCode" step="1" min="1" preci="0"></ui-num-input></ui-prop>
      <ui-prop><ui-label slot="label" value="Version name"></ui-label><ui-input slot="content" id="versionName" placeholder="0.0.2"></ui-input></ui-prop>
      <p class="hint">Mỗi lần up chợ hoặc cài đè lên máy: tăng Version code (lớn hơn lần trước).</p>

      <h2>Khoá ký bản release (up chợ)</h2>
      <ui-prop><ui-label slot="label" value="Key store path"></ui-label><ui-file slot="content" id="keystorePath" type="file" extensions="jks,keystore"></ui-file></ui-prop>
      <ui-prop><ui-label slot="label" value="Key store password"></ui-label><ui-input slot="content" id="keystorePassword" password></ui-input></ui-prop>
      <ui-prop><ui-label slot="label" value="Key alias"></ui-label><ui-input slot="content" id="keyAlias"></ui-input></ui-prop>
      <ui-prop><ui-label slot="label" value="Key password"></ui-label><ui-input slot="content" id="keyPassword" password></ui-input></ui-prop>
      <p class="hint">Lưu ở native/engine/android/keystore.properties trên máy này, không đưa lên git.</p>

      <div class="buttons">
        <ui-button id="device" class="blue">Build debug ra máy</ui-button>
        <ui-button id="store" class="green">Build release up chợ</ui-button>
      </div>
      <p class="hint">Debug ra máy: ký khoá debug như nút Run của Android Studio, tự cài đè app cũ qua cáp USB.<br>
      Release up chợ: ra file .aab (up Google Play) và .apk, ký bằng khoá ở trên.</p>

      <div id="status" class="status"></div>
    </div>`,
  style: `
    .ef { padding: 10px 14px; overflow-y: auto; height: 100%; box-sizing: border-box; }
    h2 { font-size: 13px; margin: 14px 0 6px; }
    ui-prop { margin: 4px 0; }
    .hint { color: var(--color-normal-contrast-weakest); font-size: 11px; margin: 4px 0 8px; line-height: 1.5; }
    .buttons { display: flex; gap: 10px; margin-top: 16px; }
    .buttons ui-button { flex: 1; height: 32px; }
    .status { margin-top: 12px; white-space: pre-wrap; word-break: break-all; font-size: 12px; line-height: 1.6; }
    .status.ok { color: var(--color-success-fill); }
    .status.err { color: var(--color-danger-fill); }
  `,
  $: {
    versionCode: '#versionCode', versionName: '#versionName',
    keystorePath: '#keystorePath', keystorePassword: '#keystorePassword', keyAlias: '#keyAlias', keyPassword: '#keyPassword',
    device: '#device', store: '#store', status: '#status',
  },
  methods: {
    fields() {
      const $ = this.$;
      return {
        versionCode: $.versionCode.value, versionName: $.versionName.value,
        keystorePath: $.keystorePath.value, keystorePassword: $.keystorePassword.value,
        keyAlias: $.keyAlias.value, keyPassword: $.keyPassword.value,
      };
    },
    show(text, kind) {
      this.$.status.textContent = text;
      this.$.status.className = 'status' + (kind ? ' ' + kind : '');
    },
    async start(mode) {
      const r = await Editor.Message.request('ef-android', 'start-build', mode, this.fields());
      if (!r.ok) { this.show(r.error, 'err'); return; }
      this.show(`${MODE_TITLE[mode]}: bắt đầu…`);
      this.poll();
    },
    poll() {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.refresh(), 1500);
      this.refresh();
    },
    async refresh() {
      const s = await Editor.Message.request('ef-android', 'build-status');
      const title = MODE_TITLE[s.mode] || 'Build';
      const busy = s.state === 'building';
      this.$.device.disabled = busy; this.$.store.disabled = busy;
      if (busy) { this.show(`${title} (version ${s.version || ''}): ${s.step || '…'}`); return; }
      clearInterval(this.timer);
      if (s.state === 'failed') { this.show(`${title}: LỖI\n${s.error || ''}`, 'err'); return; }
      if (s.state === 'done') {
        const lines = [`${title}: XONG`];
        if (s.installed) lines.push(s.installed);
        for (const f of s.files || []) lines.push(f);
        if (s.sha) lines.push(`Ký bởi: ${s.owner}`, `SHA256: ${s.sha}`);
        this.show(lines.join('\n'), 'ok');
      }
    },
  },
  async ready() {
    const s = await Editor.Message.request('ef-android', 'load-settings');
    for (const k of Object.keys(s)) if (this.$[k]) this.$[k].value = s[k];
    this.$.device.addEventListener('confirm', () => this.start('device'));
    this.$.store.addEventListener('confirm', () => this.start('store'));
    this.poll();   // a build started before the panel was opened
  },
  close() { clearInterval(this.timer); },
});
