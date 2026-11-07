const choiceDrafts = new Map();

function updateInteraction() {
  const host = $('interaction');
  if (!host) return;
  const prompt = state.detail?.interaction;
  const blocked = statusOf(state.detail?.terminal) === 'blocked';
  host.classList.toggle('hidden', !blocked || !prompt);
  $('composer').classList.toggle('hidden', blocked && !!prompt);
  if (!blocked || !prompt) {
    host.replaceChildren();
    delete host.dataset.signature;
    return;
  }
  const key = `${state.selected}:${prompt.id}`;
  const sent = [...outbox.values()].some(
    (item) =>
      item.address === state.selected &&
      item.interaction?.id === prompt.id &&
      item.state !== 'failed',
  );
  const disabled = state.sendBusy || !!state.detailError || sent;
  const selected = choiceDrafts.get(key);
  const signature = JSON.stringify([key, prompt, selected, disabled, I18n.language]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const question = el('div', 'question-text', prompt.question);
  question.id = 'question-text';
  const choices = el('div', 'question-choices');
  choices.setAttribute('role', 'radiogroup');
  choices.setAttribute('aria-labelledby', 'question-text');
  for (const choice of prompt.choices) {
    const option = button(`question-choice${selected === choice.id ? ' selected' : ''}`, '', () => {
      choiceDrafts.set(key, choice.id);
      updateInteraction();
      host.querySelector(`[data-choice-id="${choice.id}"]`)?.focus({ preventScroll: true });
    });
    option.dataset.choiceId = choice.id;
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-checked', String(selected === choice.id));
    option.disabled = disabled;
    option.append(el('span', 'choice-label', choice.label));
    if (choice.description) option.append(el('span', 'choice-description', choice.description));
    choices.append(option);
  }
  const submit = button('primary question-submit', tr('submit_choice'), () =>
    sendMessage({ interactionId: prompt.id, choiceId: selected }),
  );
  submit.id = 'submit-choice';
  submit.disabled = disabled || !selected;
  host.replaceChildren(question, choices, submit);
}
