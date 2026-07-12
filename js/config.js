window.EVENT_MANAGER_CONFIG = {
  // GitHub Pagesのリポジトリ名と揃えています。
  appId: "legacy-lily-event-manager",

  // Legacyグループ Lily店のブランド設定です。
  brandName: "Legacy Lily店",
  title: "Legacy Lily店 勤怠・予約管理",
  eyebrow: "Legacy Group / Lily",
  logoPath: "./assets/lily-mark-silver.png",
  wideLogoPath: "./assets/lily-wordmark-silver.png",
  logoAlt: "Legacy Lily店 ロゴ",

  // 安全な既定値として、このブラウザ内だけに保存します。
  localStorageVersion: "v2",
  storageMode: "supabase",
  supabaseUrl: "https://cdnbkbryksrhioajgorg.supabase.co",
  supabaseAnonKey: "sb_publishable_d-ydLZw9k8vNPpDnu_QDGA_ACjkGL_i",
  // Supabaseを使う場合は、イベントごとに重複しない行IDへ変更してください。
  stateRowId: "legacy-lily-event-manager",

  // core.jsが生成する初期データをイベント向けに差し替えます。
  core: {
    sitePassword: "lily",
    adminPassword: "lily2026",
    // 0=日曜日 ... 6=土曜日
    eventWeekdays: [5, 6],
    eventStartDate: "2026-07-15",
    reservationOpenWeekday: 3,
    reservationOpenTime: "22:00",
    archiveGraceDays: 0,
    extraEventDates: [],
    firstWeekHolidayCandidates: true,
    initialRoles: ["幹部", "ホスト", "体入"],
    initialUsers: [
      {
        id: "u_legacy_lily_manager",
        display_name: "Lily運営",
        kana: "りりーうんえい",
        role: "幹部",
      },
    ],
  },
};
