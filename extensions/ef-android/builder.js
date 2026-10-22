'use strict';
// Adds the "EF Android" section to the Build panel (Android only) and hooks the build (hooks.js).
exports.configs = {
  android: {
    hooks: './hooks.js',
    options: {
      output: {
        label: 'Đóng gói sau Build',
        description: 'Chạy ngay sau khi Cocos build xong, không cần bấm Make. Version: native/engine/android/version.properties. Khoá ký: native/engine/android/keystore.properties',
        default: 'store',
        render: {
          ui: 'ui-select',
          items: [
            { label: 'Bản lên chợ: AAB + APK release, ký khoá thật', value: 'store' },
            { label: 'Bản test: APK tối ưu, cài cạnh app chợ (.cocos)', value: 'test' },
            { label: 'Không đóng gói (tự làm bằng Android Studio)', value: 'none' },
          ],
        },
      },
    },
  },
};
