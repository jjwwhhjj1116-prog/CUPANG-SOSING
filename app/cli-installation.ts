/** Versioned public source package. App/Cloudflare login credentials must never
 * be embedded in an npm command or copied into the terminal. */
export const CLI_RELEASE_VERSION='0.1.1';
export const CLI_RELEASE_TAG='yoofam-cli-v0.1.1';
export const CLI_PACKAGE_URL=`https://raw.githubusercontent.com/jjwwhhjj1116-prog/CUPANG-SOSING/${CLI_RELEASE_TAG}/public/downloads/yoofam-studio-cli-${CLI_RELEASE_VERSION}.tgz`;
export function cliInstallCommands(platform:'windows'|'mac'){
 const npm=platform==='windows'?'npm.cmd':'npm',cli=platform==='windows'?'yoofam-studio.cmd':'yoofam-studio';
 return {install:`${npm} install --global --ignore-scripts --no-audit --no-fund '${CLI_PACKAGE_URL}'`,status:`${cli} status`,start:`${cli} start`,version:`${cli} --version`};
}
