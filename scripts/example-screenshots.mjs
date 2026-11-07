import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function captureExamples(c, root) {
  const folder = resolve(root, 'docs/images');
  const diagram = readFileSync(resolve(root, 'docs/examples/message-flow.mmd'), 'utf8');
  mkdirSync(folder, { recursive: true });
  await c.command('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await c.command('Emulation.setTimezoneOverride', { timezoneId: 'UTC' });
  const scenes = {
    en: {
      titles: [
        'Refine the search flow',
        'Add response caching',
        'Choose a preview theme',
        'Update shortcuts',
        'Review layout',
      ],
      user: 'Add search and keep the filters visible.',
      assistant:
        '**Search is ready.**\n\nFilters stay selected while results update.\n\n```text\nSearch → Filter → Results\n```',
      followup: 'Check narrow screens too.',
      progress: 'Checking the 360 px layout now.',
      activity: 'Checking layout',
      diagramTitle: 'Message delivery',
      diagramPrompt: 'Show how messages reach the agents.',
      diagramText: 'One bridge connects the phone to your Herdr agents.',
      imageTitle: 'Orbit study',
      imagePrompt: 'Show me the orbit illustration.',
      imageText: 'Three paths around a shared center.',
      playbackTitle: 'Motion and sound',
      playbackPrompt: 'Share the animation and completion sound.',
      playbackText: 'A four-second loop and a short chime.',
      questionUser: 'Prepare a preview of the dashboard.',
      questionAssistant: 'The layout is ready. Choose a theme for the preview.',
      question: 'Which theme should I use?',
      choices: [
        { id: 'dark', label: 'Dark', description: 'Charcoal panels with cyan accents.' },
        { id: 'light', label: 'Light', description: 'White panels with blue accents.' },
        { id: 'system', label: 'Follow system', description: 'Match the device appearance.' },
      ],
    },
    ko: {
      titles: [
        '검색 흐름 개선',
        '응답 캐시 추가',
        '미리보기 테마 선택',
        '단축키 갱신',
        '레이아웃 검토',
      ],
      user: '검색창을 추가하고 필터는 계속 보이게 해줘.',
      assistant:
        '**검색창을 추가했어요.**\n\n검색 결과가 바뀌어도 필터 선택을 유지합니다.\n\n```text\n검색 → 필터 → 결과\n```',
      followup: '좁은 화면에서도 확인해줘.',
      progress: '360px 화면의 배치를 확인하고 있어요.',
      activity: '레이아웃 확인',
      diagramTitle: '메시지 전달 구조',
      diagramPrompt: '메시지가 에이전트에 전달되는 구조를 보여줘.',
      diagramText: '브릿지를 통해 폰에서 Herdr 에이전트에 연결합니다.',
      imageTitle: '궤도 이미지',
      imagePrompt: '궤도 이미지를 보여줘.',
      imageText: '하나의 중심을 도는 세 개의 궤도입니다.',
      playbackTitle: '움직임과 소리',
      playbackPrompt: '애니메이션과 완료 알림음을 보여줘.',
      playbackText: '4초 반복 영상과 짧은 알림음입니다.',
      questionUser: '대시보드 미리보기를 준비해줘.',
      questionAssistant: '레이아웃을 준비했어요. 미리보기에 적용할 테마를 골라주세요.',
      question: '어떤 테마를 적용할까요?',
      choices: [
        { id: 'dark', label: '다크', description: '짙은 회색 패널과 청록색 강조.' },
        { id: 'light', label: '라이트', description: '흰색 패널과 파란색 강조.' },
        { id: 'system', label: '시스템 설정', description: '기기의 화면 설정에 맞춥니다.' },
      ],
    },
  };
  async function capture(name) {
    await c.evaluate(`document.activeElement?.blur();document.fonts.ready`);
    await new Promise((r) => setTimeout(r, 300));
    const safe = await c.evaluate(
      `({errors:designErrors.length,overflow:document.documentElement.scrollWidth>innerWidth})`,
    );
    if (safe.errors || safe.overflow) throw Error('Example screenshot failed layout checks');
    const shot = await c.command('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(folder, name), Buffer.from(shot.data, 'base64'));
  }
  async function waitFor(expression) {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await c.evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error(`Example did not become ready: ${expression}`);
  }
  async function openExample(title, prompt, text, media = []) {
    await c.evaluate(`(()=>{
      closeDetail();
      const terminal=fixtureTerminals[4];terminal.sessionTitle=${JSON.stringify(title)};
      terminal.agent='claude';terminal.status={state:'done',app:'claude'};
      fixtureDetail={terminal,canSend:true,observedAt:new Date(exampleNow).toISOString(),conversation:{hasMore:false,messages:[
        {id:'example-request',ordinal:1,role:'user',text:${JSON.stringify(prompt)},timestamp:new Date(exampleNow-60000).toISOString()},
        {id:'example-response',ordinal:2,role:'assistant',text:${JSON.stringify(text)},media:${JSON.stringify(media)},timestamp:new Date(exampleNow).toISOString()}
      ]}};
      openDetail(terminal.address);
    })()`);
    await waitFor(`!!state.detail&&document.querySelector('[data-message-id="example-response"]')`);
    await c.evaluate(`$('detail-body').scrollTop=0`);
  }
  for (const [language, scene] of Object.entries(scenes)) {
    await c.evaluate(`(()=>{
      if(state.selected)closeDetail();
      I18n.setLanguage(${JSON.stringify(language)});
      window.exampleScene=${JSON.stringify(scene)};
      window.exampleNow=Date.parse('2026-01-15T14:32:00Z');
      Date.now=()=>exampleNow;
      outbox.clear();drafts.clear();choiceDrafts.clear();pendingMessage=null;
      clearTimeout(toastTimer);$('toast').classList.add('hidden');$('toast').textContent='';
      fixtureResolveFail=false;fixtureReceiptMissing=false;fixtureNotification=null;
      state.tab='tasks';state.filter='all';state.machine='all';state.search='';state.sendBusy=false;state.error='';
      fixtureTerminals=[
        ['workstation/t1','atlas-web','codex','working',125],
        ['mini-server/t2','orbit-api','claude','working',48],
        ['laptop/t3','signal-kit','codex','blocked',0],
        ['laptop/t4','notes-cli','cursor','done',0],
        ['workstation/t5','frame-ui','claude','done',0]
      ].map(([address,project,agent,status,seconds],i)=>({
        address,project,agent,status:{state:status,app:agent},sessionId:'example-'+i,
        sessionTitle:exampleScene.titles[i],created_ms:exampleNow-i*60000,
        lastResponseAt:new Date(exampleNow-i*60000).toISOString(),
        workingSince:seconds?new Date(exampleNow-seconds*1000).toISOString():null
      }));
      fixtureSnapshot={localMachine:'workstation',terminals:fixtureTerminals,machines:[{name:'laptop',state:'connected'},{name:'mini-server',state:'connected'}],observedAt:new Date(exampleNow).toISOString()};
      state.snapshot=fixtureSnapshot;state.online=true;render();window.scrollTo(0,0);
    })()`);
    await capture(`sessions-${language}.png`);
    await c.evaluate(`(()=>{
      const texts=[exampleScene.user,exampleScene.assistant,exampleScene.followup,exampleScene.progress];
      fixtureDetail={terminal:fixtureTerminals[0],canSend:true,observedAt:new Date(exampleNow).toISOString(),conversation:{
        hasMore:false,messages:texts.map((text,i)=>({id:'example-chat-'+i,ordinal:i+1,role:i%2?'assistant':'user',text,timestamp:new Date(exampleNow-(4-i)*60000).toISOString()})),
        activity:{state:'running',label:exampleScene.activity,timestamp:new Date(exampleNow).toISOString()}
      }};
      openDetail(fixtureTerminals[0].address);
    })()`);
    await new Promise((r) => setTimeout(r, 150));
    await c.evaluate(`$('detail-body').scrollTop=0`);
    await capture(`conversation-${language}.png`);
    await c.evaluate(`(()=>{
      closeDetail();
      fixtureDetail={terminal:fixtureTerminals[2],canSend:false,observedAt:new Date(exampleNow).toISOString(),
        conversation:{hasMore:false,messages:[
          {id:'question-user',ordinal:1,role:'user',text:exampleScene.questionUser,timestamp:new Date(exampleNow-60000).toISOString()},
          {id:'question-agent',ordinal:2,role:'assistant',text:exampleScene.questionAssistant,timestamp:new Date(exampleNow).toISOString()}
        ]},
        interaction:{id:'example-theme',kind:'question',question:exampleScene.question,choices:exampleScene.choices}
      };
      openDetail(fixtureTerminals[2].address);
    })()`);
    await new Promise((r) => setTimeout(r, 150));
    await c.evaluate(
      `document.querySelector('[data-choice-id="dark"]').click();$('detail-body').scrollTop=0`,
    );
    await capture(`choices-${language}.png`);
    await openExample(
      scene.diagramTitle,
      scene.diagramPrompt,
      `${scene.diagramText}\n\n\`\`\`mermaid\n${diagram}\`\`\``,
    );
    await waitFor(
      `(()=>{const image=document.querySelector('.mermaid-image');return image?.complete&&image.naturalWidth>0;})()`,
    );
    if (
      !(await c.evaluate(
        `(()=>{const image=document.querySelector('.mermaid-image');return image.width<=image.parentElement.clientWidth-24;})()`,
      ))
    )
      throw Error('Example diagram does not fit the phone width');
    await capture(`mermaid-${language}.png`);
    await openExample(scene.imageTitle, scene.imagePrompt, scene.imageText, [
      { id: '4'.repeat(64), kind: 'image', name: 'orbit-study.png' },
    ]);
    await waitFor(`document.querySelector('.media-image img')?.naturalWidth===640`);
    await capture(`image-${language}.png`);
    await openExample(scene.playbackTitle, scene.playbackPrompt, scene.playbackText, [
      { id: '5'.repeat(64), kind: 'audio', name: 'completion-chime.wav' },
      { id: '6'.repeat(64), kind: 'video', name: 'orbit-loop.mp4' },
    ]);
    await c.evaluate(
      `document.querySelectorAll('audio,video').forEach(p=>{p.muted=true;p.load()})`,
    );
    await waitFor(
      `[...document.querySelectorAll('audio,video')].every(p=>p.readyState>=2&&Number.isFinite(p.duration)&&!p.error)`,
    );
    for (const type of ['audio', 'video']) {
      await c.evaluate(`document.querySelector('${type}').play()`);
      await waitFor(`document.querySelector('${type}').currentTime>0.1`);
      await c.evaluate(`document.querySelector('${type}').pause()`);
    }
    await c.evaluate(
      `document.querySelector('audio').currentTime=0;document.querySelector('video').currentTime=1;`,
    );
    await waitFor(`!document.querySelector('video').seeking`);
    await c.evaluate(
      `document.querySelectorAll('audio,video').forEach(p=>p.muted=false);$('detail-body').scrollTop=$('detail-body').scrollHeight`,
    );
    await capture(`playback-${language}.png`);
  }
  console.log(
    'Saved twelve example screenshots; Mermaid, image decoding, audio and video playback passed.',
  );
}
