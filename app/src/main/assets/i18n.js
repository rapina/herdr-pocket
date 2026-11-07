const I18n = (() => {
  const messages = {
    media_close: { ko: '닫기', en: 'Close' },
    media_retry: { ko: '다시 시도', en: 'Retry' },
    media_open: { ko: '이미지 확대', en: 'Open image' },
    media_zoom: { ko: '원본 크기', en: 'Actual size' },
    media_loading: { ko: '불러오는 중…', en: 'Loading…' },
    media_failed: {
      ko: '불러올 수 없습니다. 파일 위치·연결·형식을 확인하세요.',
      en: 'Could not load. Check the file location, connection, and format.',
    },
    notifications: { ko: '알림', en: 'Notifications' },
    push_enable: { ko: '알림 켜기', en: 'Enable notifications' },
    push_disable: { ko: '알림 끄기', en: 'Disable notifications' },
    push_connecting: { ko: '설정 중…', en: 'Setting up…' },
    push_enabled: { ko: '켜짐', en: 'On' },
    push_disabled: { ko: '꺼짐', en: 'Off' },
    push_system_settings: { ko: '소리·진동 설정', en: 'Sound and vibration' },
    push_not_configured: {
      ko: '연결 서버에 Firebase 설정이 필요합니다.',
      en: 'Set up Firebase on the bridge first.',
    },
    push_permission_denied: {
      ko: 'Android 알림 권한이 꺼져 있습니다.',
      en: 'Android notification permission is off.',
    },
    push_registration_pending: {
      ko: '알림 연결을 재시도 중입니다.',
      en: 'Retrying notification registration.',
    },
    push_session_expired: {
      ko: '이 알림의 세션은 종료됐습니다.',
      en: 'This notification’s session has ended.',
    },
    invalid_push_event: { ko: '알림을 열 수 없습니다.', en: 'Could not open this notification.' },
    invalid_push_device: {
      ko: '알림 기기를 등록하지 못했습니다.',
      en: 'Could not register this device.',
    },
    push_device_limit: {
      ko: '알림 기기 등록 한도에 도달했습니다.',
      en: 'Notification device limit reached.',
    },
    diagram: { ko: 'Mermaid 다이어그램', en: 'Mermaid diagram' },
    diagram_loading: { ko: '다이어그램 표시 중…', en: 'Rendering diagram…' },
    diagram_failed: {
      ko: '다이어그램을 표시하지 못했습니다.',
      en: 'Could not render this diagram.',
    },
    diagram_code: { ko: '코드', en: 'Code' },

    copy_message: { ko: '메시지 복사', en: 'Copy message' },
    copied: { ko: '복사됨', en: 'Copied' },
    path_copied: { ko: '파일 경로 복사됨', en: 'File path copied' },
    link_open_failed: { ko: '링크를 열지 못했습니다.', en: 'Could not open the link.' },
    copy_failed: { ko: '복사하지 못했습니다.', en: 'Could not copy the message.' },
    submit_choice: { ko: '선택 전송', en: 'Submit choice' },
    question_changed: {
      ko: '질문이 바뀌었습니다. 선택지를 다시 확인하세요.',
      en: 'The question changed. Review the current choices.',
    },
    question_answered: {
      ko: '이미 응답한 질문입니다.',
      en: 'This question has already been answered.',
    },
    invalid_choice: {
      ko: '현재 선택지에서 골라 주세요.',
      en: 'Choose one of the current options.',
    },

    timeout: {
      ko: '응답을 기다리는 시간이 길어지고 있습니다. 연결을 확인하세요.',
      en: 'The request timed out. Check the connection.',
    },
    android_only: {
      ko: 'Android 앱에서 열어 주세요.',
      en: 'Open this in the Android app.',
    },
    elapsed: {
      ko: '작업 경과 시간',
      en: 'Working time',
    },
    terminal: {
      ko: '터미널',
      en: 'Terminal',
    },
    local_machine: {
      ko: '이 PC',
      en: 'This PC',
    },
    working: {
      ko: '작업 중',
      en: 'Working',
    },
    blocked: {
      ko: '입력 대기',
      en: 'Needs input',
    },
    done: {
      ko: '완료',
      en: 'Done',
    },
    idle: {
      ko: '대기',
      en: 'Idle',
    },
    unknown: {
      ko: '상태 없음',
      en: 'Unknown',
    },
    connected: {
      ko: '연결됨',
      en: 'Connected',
    },
    disconnected: {
      ko: '연결 끊김',
      en: 'Disconnected',
    },
    not_connected: {
      ko: '미연결',
      en: 'Not connected',
    },
    tasks: {
      ko: '작업',
      en: 'Sessions',
    },
    devices: {
      ko: '기기',
      en: 'Devices',
    },
    settings: {
      ko: '설정',
      en: 'Settings',
    },
    search: {
      ko: '검색',
      en: 'Search',
    },
    search_tasks: {
      ko: '작업 검색',
      en: 'Search sessions',
    },
    all: {
      ko: '전체',
      en: 'All',
    },
    no_tasks: {
      ko: '작업 없음',
      en: 'No sessions',
    },
    loading: {
      ko: '불러오는 중…',
      en: 'Loading…',
    },
    bridge_prefix: {
      ko: '연결 서버 · ',
      en: 'Bridge · ',
    },
    last_known: {
      ko: '마지막 확인 정보',
      en: 'Last known state',
    },
    connection_settings: {
      ko: '연결 설정',
      en: 'Connection',
    },
    server_url: {
      ko: 'PC 주소',
      en: 'Server URL',
    },
    connection_key: {
      ko: '연결 키',
      en: 'Connection key',
    },
    key_saved: {
      ko: '저장됨 · 변경 시 입력',
      en: 'Saved · enter to replace',
    },
    key_placeholder: {
      ko: '64자리 키',
      en: '64-character key',
    },
    connect: {
      ko: '연결',
      en: 'Connect',
    },
    connecting: {
      ko: '연결 중…',
      en: 'Connecting…',
    },
    forget: {
      ko: '연결 정보 삭제',
      en: 'Forget connection',
    },
    back: {
      ko: '작업 목록으로',
      en: 'Back to sessions',
    },
    refresh_chat: {
      ko: '대화 새로고침',
      en: 'Refresh conversation',
    },
    older: {
      ko: '이전 대화',
      en: 'Older messages',
    },
    message_placeholder: {
      ko: '지시 입력…',
      en: 'Message…',
    },
    message_label: {
      ko: '추가 지시',
      en: 'Message',
    },
    send: {
      ko: '메시지 보내기',
      en: 'Send message',
    },
    approval: {
      ko: '승인 대기 · PC에서 확인',
      en: 'Approval needed on the PC',
    },
    send_unavailable: {
      ko: '전송 불가',
      en: 'Sending unavailable',
    },
    you: {
      ko: '나',
      en: 'You',
    },
    sending: {
      ko: '보내는 중…',
      en: 'Sending…',
    },
    sent: {
      ko: '전달됨',
      en: 'Delivered',
    },
    delivery_unknown: {
      ko: '전달 확인 필요',
      en: 'Delivery unconfirmed',
    },
    failed: {
      ko: '전송 실패',
      en: 'Not sent',
    },
    no_chat: {
      ko: '대화 없음',
      en: 'No messages',
    },
    checking_previous: {
      ko: '이전 전송 확인 중…',
      en: 'Checking the previous message…',
    },
    delivery_check: {
      ko: '전송 결과를 확인 중입니다. 연결되면 다시 확인합니다.',
      en: 'Checking delivery. It will be checked again when connected.',
    },
    failed_hint: {
      ko: '전송 실패 · 내용을 확인해 주세요.',
      en: 'Not sent. Check your message.',
    },
    activity_command: {
      ko: '명령 실행',
      en: 'Command',
    },
    activity_edit: {
      ko: '파일 수정',
      en: 'File edit',
    },
    activity_read: {
      ko: '파일 확인',
      en: 'File read',
    },
    activity_tool: {
      ko: '도구 실행',
      en: 'Tool',
    },
    session_unavailable: {
      ko: '세션 연결 안 됨',
      en: 'Session unavailable',
    },
    transcript_unavailable: {
      ko: '대화 기록을 읽을 수 없음',
      en: 'Conversation unavailable',
    },
    session_connection_failed: {
      ko: '세션 기록 연결 실패',
      en: 'Cannot connect to session history',
    },
    hc_timeout: {
      ko: 'Herdr 응답 시간이 초과됐습니다.',
      en: 'Herdr timed out.',
    },
    hc_failed: {
      ko: 'Herdr 요청을 처리하지 못했습니다. 기기 연결과 터미널 상태를 확인하세요.',
      en: 'Herdr request failed. Check the device and terminal.',
    },
    invalid_address: {
      ko: '터미널 주소가 올바르지 않습니다.',
      en: 'Invalid terminal address.',
    },
    restart_unknown: {
      ko: '서버가 다시 시작되어 전송 결과를 확인할 수 없습니다. 터미널 출력을 확인하세요.',
      en: 'The bridge restarted. Check the conversation before resending.',
    },
    json_required: {
      ko: 'JSON 요청만 지원합니다.',
      en: 'JSON is required.',
    },
    too_long: {
      ko: '메시지가 너무 깁니다.',
      en: 'Message too long.',
    },
    invalid_json: {
      ko: '요청을 읽을 수 없습니다.',
      en: 'Invalid request body.',
    },
    unauthorized: {
      ko: '연결 키를 확인하세요.',
      en: 'Check the connection key.',
    },
    browser_forbidden: {
      ko: '브라우저 직접 요청은 지원하지 않습니다.',
      en: 'Direct browser requests are not supported.',
    },
    invalid_cursor: {
      ko: '대화 위치가 올바르지 않습니다.',
      en: 'Invalid conversation cursor.',
    },
    receipt_missing: {
      ko: '전송 기록이 없습니다.',
      en: 'No delivery record yet.',
    },
    invalid_request: {
      ko: '요청이 올바르지 않습니다.',
      en: 'Invalid request.',
    },
    invalid_id: {
      ko: '전송 ID가 올바르지 않습니다.',
      en: 'Invalid message ID.',
    },
    invalid_text: {
      ko: '메시지는 1~4000자의 일반 텍스트로 입력하세요.',
      en: 'Enter 1–4000 characters of plain text.',
    },
    reopen: {
      ko: '터미널을 다시 열어 주세요.',
      en: 'Reopen the session.',
    },
    id_reused: {
      ko: '이미 다른 메시지에 사용된 전송 ID입니다.',
      en: 'This ID was used for another message.',
    },
    send_in_progress: {
      ko: '이 터미널에 전송 중인 메시지가 있습니다.',
      en: 'A message is already being sent to this terminal.',
    },
    target_changed: {
      ko: '대상 에이전트가 바뀌었거나 종료됐습니다. 터미널을 다시 확인하세요.',
      en: 'The agent changed or exited. Reopen the session.',
    },
    session_changed: {
      ko: '대화 세션이 바뀌었습니다. 다시 열어 주세요.',
      en: 'The conversation changed. Reopen the session.',
    },
    approval_required: {
      ko: '승인이나 선택을 기다리고 있습니다. Herdr에서 해당 요청을 확인하세요.',
      en: 'Respond to the approval prompt in Herdr.',
    },
    id_conflict: {
      ko: '전송 ID가 충돌했습니다.',
      en: 'Message ID conflict.',
    },
    sending_conflict: {
      ko: '전송 중인 메시지가 있습니다.',
      en: 'A message is already being sent.',
    },
    delivery_sending: {
      ko: '터미널에 보내는 중입니다.',
      en: 'Sending to the terminal.',
    },
    delivery_sent: {
      ko: '터미널에 전달했습니다. 에이전트의 응답은 출력에서 확인하세요.',
      en: 'Delivered to the terminal.',
    },
    delivery_uncertain: {
      ko: '전달 여부를 확인할 수 없습니다. 다시 보내기 전에 최근 출력을 확인하세요.',
      en: 'Delivery is uncertain. Check the conversation before resending.',
    },
    unsupported_request: {
      ko: '지원하지 않는 요청입니다.',
      en: 'Unsupported request.',
    },
    server_error: {
      ko: '서버에서 요청을 처리하지 못했습니다.',
      en: 'The bridge could not process the request.',
    },
    invalid_url: {
      ko: 'HTTPS 브릿지 주소를 입력하세요. 예: https://bridge.example.com:9443',
      en: 'Enter an HTTPS bridge URL, such as https://bridge.example.com:9443.',
    },
    key_required: {
      ko: '연결 키를 입력하세요.',
      en: 'Enter the connection key.',
    },
    invalid_key: {
      ko: '연결 키는 64자리입니다.',
      en: 'The connection key must have 64 hexadecimal characters.',
    },
    save_failed: {
      ko: '연결 정보를 저장하지 못했습니다.',
      en: 'Could not save the connection.',
    },
    configure_first: {
      ko: '먼저 PC를 연결하세요.',
      en: 'Connect to a PC first.',
    },
    response_large: {
      ko: '응답이 너무 큽니다.',
      en: 'Response too large.',
    },
    invalid_response: {
      ko: 'PC가 올바른 응답을 보내지 않았습니다.',
      en: 'The PC returned an invalid response.',
    },
    network_error: {
      ko: '브릿지에 연결할 수 없습니다. 네트워크와 브릿지를 확인하세요.',
      en: 'Cannot reach the bridge. Check your network and the bridge.',
    },
    request_failed: {
      ko: '요청을 처리하지 못했습니다.',
      en: 'Request failed.',
    },
    language: {
      ko: '언어',
      en: 'Language',
    },
    refresh: {
      ko: '새로고침',
      en: 'Refresh',
    },
    main_nav: {
      ko: '주 메뉴',
      en: 'Main navigation',
    },
    session_detail: {
      ko: '작업 상세',
      en: 'Session details',
    },
    terminals_count: {
      ko: '터미널 {count}개',
      en: '{count} terminals',
    },
    stale_chat: {
      ko: '{error} 마지막 확인 대화입니다.',
      en: '{error} Showing the last known conversation.',
    },
    activity_running: {
      ko: '{activity} 중',
      en: '{activity} in progress',
    },
    activity_complete: {
      ko: '{activity} 완료',
      en: '{activity} complete',
    },
    checking_delivery: {
      ko: '{error} 전달 여부를 확인 중입니다.',
      en: '{error} Checking delivery.',
    },
    receipt_pending: {
      ko: '전달 확인 중…',
      en: 'Checking delivery…',
    },
  };
  const aliases = new Map(Object.entries(messages).map(([key, value]) => [value.ko, key]));
  let language =
    localStorage.getItem('pocket-language') || (navigator.language.startsWith('ko') ? 'ko' : 'en');
  if (!['ko', 'en'].includes(language)) language = 'en';
  function text(key, values = {}) {
    const entry = messages[key] || messages[aliases.get(key)];
    const template = entry ? entry[language] : key || '';
    return template.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  }
  function setLanguage(value) {
    language = value === 'ko' ? 'ko' : 'en';
    localStorage.setItem('pocket-language', language);
    document.documentElement.lang = language;
  }
  setLanguage(language);
  return {
    text,
    setLanguage,
    get language() {
      return language;
    },
    messages,
  };
})();
const tr = I18n.text;
