import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from 'cloudflare:workers';
import { authenticateCloudflareAccess, AccessAuthenticationError } from '@/app/cloudflare-access';

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
  /** Present only after the server verified the Cloudflare Access JWT. */
  verifiedAccess?: boolean;
};

const USER_ID_HEADER = 'oai-authenticated-user-id';
const USER_EMAIL_HEADER = 'oai-authenticated-user-email';
const USER_FULL_NAME_HEADER = 'oai-authenticated-user-full-name';
const USER_FULL_NAME_ENCODING_HEADER =
  'oai-authenticated-user-full-name-encoding';
const PERCENT_ENCODED_UTF8 = 'percent-encoded-utf-8';
const SIGN_IN_PATH = '/signin-with-chatgpt';
const SIGN_OUT_PATH = '/signout-with-chatgpt';
const CALLBACK_PATH = '/callback';

export async function getChatGPTUser(onAccessError?: (error: AccessAuthenticationError) => void): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  if (process.env.NODE_ENV === 'production') {
    const accessEnv = env as { CLOUDFLARE_ACCESS_TEAM_DOMAIN?: string; CLOUDFLARE_ACCESS_AUD?: string };
    try {
      const identity = await authenticateCloudflareAccess(requestHeaders, {teamDomain:accessEnv.CLOUDFLARE_ACCESS_TEAM_DOMAIN,audience:accessEnv.CLOUDFLARE_ACCESS_AUD});
      return {userId:identity.userId,email:identity.email,displayName:identity.displayName,fullName:null,verifiedAccess:true};
    } catch (error) {
      if (error instanceof AccessAuthenticationError) { onAccessError?.(error); return null; }
      throw error;
    }
  }
  const userId = requestHeaders.get(USER_ID_HEADER);
  const email = requestHeaders.get(USER_EMAIL_HEADER);
  if (!userId || !email) return null;

  const encodedFullName = requestHeaders.get(USER_FULL_NAME_HEADER);
  const fullName =
    encodedFullName &&
    requestHeaders.get(USER_FULL_NAME_ENCODING_HEADER) === PERCENT_ENCODED_UTF8
      ? safeDecodeURIComponent(encodedFullName)
      : null;

  return {
    userId,
    displayName: fullName ?? email,
    email,
    fullName,
  };
}

/** Resolve ownership again without ever downgrading a failed production login to local-demo. */
export async function getWorkspaceOwnerId(): Promise<string> {
  const user = await getChatGPTUser();
  if (process.env.NODE_ENV === 'production' && !user?.verifiedAccess) throw new AccessAuthenticationError('missing_token');
  return user?.userId ?? 'local-demo';
}

export async function requireChatGPTUser(
  returnTo: string,
): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;

  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_IN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

export function chatGPTSignOutPath(returnTo = '/'): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) return '/';

  let url: URL;
  try {
    url = new URL(value, 'https://app.local');
  } catch {
    return '/';
  }
  if (url.origin !== 'https://app.local') return '/';
  if (isReservedAuthPath(url.pathname)) return '/';

  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return (
    pathname === SIGN_IN_PATH ||
    pathname === SIGN_OUT_PATH ||
    pathname === CALLBACK_PATH
  );
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
