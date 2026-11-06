export function Footer() {
  return (
    <footer className="border-t border-haze/50 py-10">
      <div className="page-x mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="flex items-center gap-2">
            <span className="h-[7px] w-[7px] rounded-full bg-cinnabar" aria-hidden />
            <span className="font-display text-[16px] tracking-[0.04em] text-paper">有所闻 · NewsNook</span>
          </p>
          <p className="mt-2 max-w-[36ch] text-[12.5px] leading-[1.8] text-paper-muted">
            本地优先的新闻阅读客户端。它是工具，不是内容平台。
          </p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 font-mono text-[10.5px] tracking-[0.12em] text-paper-faint">
          <a href="https://github.com/t59688/newsnook" target="_blank" rel="noreferrer" className="transition-colors hover:text-paper">
            GitHub
          </a>
          <a href="https://news.aizeek.com" target="_blank" rel="noreferrer" className="transition-colors hover:text-paper">
            网页版
          </a>
          <a href="https://github.com/t59688/newsnook/blob/main/docs/user-guide.md" target="_blank" rel="noreferrer" className="transition-colors hover:text-paper">
            用户手册
          </a>
          <span>AGPL-3.0</span>
        </div>
      </div>
      <div className="page-x mx-auto mt-8 max-w-6xl border-t border-haze/40 pt-5">
        <p className="font-mono text-[10px] tracking-[0.14em] text-paper-muted">
          NewsNook 有所闻 · 生产环境端侧运行架构 · 开源许可 AGPL-3.0
        </p>
      </div>
    </footer>
  )
}
