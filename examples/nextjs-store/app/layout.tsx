import type { ReactNode } from "react";
import { Header } from "./header";
import { Providers } from "./providers";
import "./globals.css";

export const metadata = { title: "Terra Demo Store", description: "Example store using the Terra Wallet SDK and Terra Pay." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main className="main">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
