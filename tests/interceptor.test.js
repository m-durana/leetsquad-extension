require('./setup');

// The interceptor is a standalone MAIN-world IIFE: it patches window.fetch and
// XMLHttpRequest, then postMessages accepted-submission results. Unlike
// content.js it has no heavy on-load side effects, so we load it for real and
// drive the patched fetch/XHR paths end to end.

// A minimal Response stand-in: the interceptor calls res.clone().text().
function fakeResponse(bodyObj) {
  const text = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return { clone: () => ({ text: () => Promise.resolve(text) }) };
}

// Resolve with the next interceptor message, or null after `timeout` ms.
function nextMessage(timeout = 100) {
  return new Promise((resolve) => {
    const handler = (e) => {
      if (e.data && e.data.source === 'leetsquad-interceptor') {
        window.removeEventListener('message', handler);
        resolve(e.data);
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, timeout);
  });
}

const CHECK_URL = 'https://leetcode.com/submissions/detail/987654321/check/';

const ACCEPTED = {
  state: 'SUCCESS',
  status_code: 10,
  status_msg: 'Accepted',
  lang: 'python3',
  status_runtime: '42 ms',
  status_memory: '17.1 MB',
  task_finish_time: 1700000000000,
};

let fetchMock;

beforeAll(() => {
  // Point the interceptor at a problem page and give it a fetch to wrap.
  // jsdom's real origin stays http://localhost, which the interceptor's
  // postMessage targetOrigin must match, so mirror it here.
  delete window.location;
  window.location = {
    pathname: '/problems/two-sum/',
    href: 'https://leetcode.com/problems/two-sum/',
    origin: 'http://localhost',
  };
  fetchMock = jest.fn();
  window.fetch = fetchMock;
  require('../submission-interceptor');
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe('interceptor: fetch path', () => {
  test('emits a rich payload on an Accepted check response', async () => {
    fetchMock.mockResolvedValue(fakeResponse(ACCEPTED));
    const got = nextMessage();
    window.fetch(CHECK_URL);
    const msg = await got;

    expect(msg).not.toBeNull();
    expect(msg.type).toBe('submissionAccepted');
    expect(msg.payload).toMatchObject({
      slug: 'two-sum',
      id: '987654321',
      lang: 'python3',
      runtime: '42 ms',
      memory: '17.1 MB',
      timestamp: 1700000000, // task_finish_time ms -> sec
    });
  });

  test('stays silent on a non-accepted (Wrong Answer) result', async () => {
    fetchMock.mockResolvedValue(fakeResponse({
      state: 'SUCCESS', status_code: 11, status_msg: 'Wrong Answer',
    }));
    const got = nextMessage();
    window.fetch(CHECK_URL);
    expect(await got).toBeNull();
  });

  test('stays silent while the run is still PENDING', async () => {
    fetchMock.mockResolvedValue(fakeResponse({ state: 'PENDING' }));
    const got = nextMessage();
    window.fetch(CHECK_URL);
    expect(await got).toBeNull();
  });

  test('ignores non-check URLs (e.g. /graphql)', async () => {
    fetchMock.mockResolvedValue(fakeResponse(ACCEPTED));
    const got = nextMessage();
    window.fetch('https://leetcode.com/graphql/');
    expect(await got).toBeNull();
  });

  test('falls back to slug from the current page URL', async () => {
    window.location.pathname = '/problems/add-two-numbers/description/';
    fetchMock.mockResolvedValue(fakeResponse(ACCEPTED));
    const got = nextMessage();
    window.fetch(CHECK_URL);
    const msg = await got;
    expect(msg.payload.slug).toBe('add-two-numbers');
    window.location.pathname = '/problems/two-sum/';
  });

  test('does not throw when the response body is not JSON', async () => {
    fetchMock.mockResolvedValue(fakeResponse('<html>rate limited</html>'));
    const got = nextMessage();
    expect(() => window.fetch(CHECK_URL)).not.toThrow();
    expect(await got).toBeNull();
  });

  test('returns the original fetch promise to the caller', async () => {
    const resp = fakeResponse(ACCEPTED);
    fetchMock.mockResolvedValue(resp);
    await expect(window.fetch(CHECK_URL)).resolves.toBe(resp);
  });
});

describe('interceptor: XHR path', () => {
  test('wraps open/send and stores the request URL', () => {
    const xhr = new XMLHttpRequest();
    // Patched open records the URL without performing a request.
    xhr.open('GET', CHECK_URL);
    expect(xhr.__leetsquadUrl).toBe(CHECK_URL);
    // open/send are replaced, not the jsdom originals.
    expect(XMLHttpRequest.prototype.open.name).not.toBe('open');
  });

  test('emits on an Accepted XHR check response', async () => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', CHECK_URL);
    // Avoid a real network send: stub send so only our load listener runs.
    const origSend = XMLHttpRequest.prototype.send;
    Object.defineProperty(xhr, 'responseText', {
      configurable: true,
      get: () => JSON.stringify(ACCEPTED),
    });
    // Re-run the patched send (which attaches the load listener) but neutralize
    // the underlying network call.
    XMLHttpRequest.prototype.send = function () {};
    const got = nextMessage();
    xhr.send();
    xhr.dispatchEvent(new Event('load'));
    XMLHttpRequest.prototype.send = origSend;

    const msg = await got;
    expect(msg).not.toBeNull();
    expect(msg.payload).toMatchObject({ slug: 'two-sum', id: '987654321', lang: 'python3' });
  });
});
