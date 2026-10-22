'use strict';
// Adds the "EF Android" section to the Build panel (Android only) and hooks the build (hooks.js).
// Easier: the EF Android panel (menu Extension → EF Android) with its two buttons sets everything.
exports.configs = {
  android: {
    hooks: './hooks.js',
    options: {
      output: {
        label: 'Đóng gói sau Build',
        description: 'Chạy ngay sau khi Cocos build xong, không cần bấm Make. Version và khoá ký: panel EF Android (menu Extension)',
        default: 'device',
        render: {
          ui: 'ui-select',
          items: [
            { label: 'Debug ra máy: cài đè app đang cài từ Android Studio', value: 'device' },
            { label: 'Release up chợ: AAB + APK, ký khoá thật', value: 'store' },
            { label: 'Bản test: APK cài cạnh app chợ (.cocos)', value: 'test' },
            { label: 'Không đóng gói (tự làm bằng Android Studio)', value: 'none' },
          ],
        },
      },
    },
  },
};
