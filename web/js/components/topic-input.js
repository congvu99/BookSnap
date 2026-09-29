// Free-text topic field with suggestions from the shared topic list. Typing a new name creates
// the topic on save; the server treats "Văn học" and "VĂN HỌC" as the same topic.
import { html, useEffect, useState } from '../../vendor/preact-htm.module.js';
import { topicsApi } from '../api-client.js';

export const TOPIC_MAX = 40;

/**
 * @param {{ id: string, value: string, onInput: (v: string) => void, onCommit?: (v: string) => void, label?: string }} props
 */
export function TopicInput({ id, value, onInput, onCommit, label = 'Chủ đề' }) {
  const [topics, setTopics] = useState(/** @type {{id:string,name:string}[]} */ ([]));

  useEffect(() => {
    topicsApi.list().then(setTopics).catch(() => setTopics([]));
  }, []);

  return html`
    <div class="field">
      <label for=${id}>${label}</label>
      <input
        id=${id}
        list=${`${id}-options`}
        placeholder="Ví dụ: Văn học, Lịch sử… (có thể để trống)"
        maxlength=${TOPIC_MAX}
        autocomplete="off"
        value=${value}
        onInput=${(e) => onInput(e.currentTarget.value)}
        onChange=${(e) => onCommit && onCommit(e.currentTarget.value)}
      />
      <datalist id=${`${id}-options`}>
        ${topics.map((t) => html`<option value=${t.name} key=${t.id}></option>`)}
      </datalist>
    </div>
  `;
}
