import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'零点行动 · ZERO POINT',description:'进入七号仓库，挑战 AI 对手。原创第一人称战术射击游戏。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="zh-CN"><body>{children}</body></html>;}
