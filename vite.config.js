import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

const SCAN_ORIGIN = 'https://10.10.107.153'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: SCAN_ORIGIN,
        changeOrigin: true,
        secure: false,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            const cookie = req.headers['x-scan-cookie']
            const xsrf = req.headers['x-scan-xsrf'] || req.headers['x-xsrf-token']

            if (cookie) {
              proxyReq.setHeader('Cookie', Array.isArray(cookie) ? cookie[0] : cookie)
            }
            if (xsrf) {
              const token = Array.isArray(xsrf) ? xsrf[0] : xsrf
              proxyReq.setHeader('X-XSRF-TOKEN', token)
              proxyReq.setHeader('X-Xsrf-Token', token)
            }

            // 勿把自定义头继续传给上游
            proxyReq.removeHeader('x-scan-cookie')
            proxyReq.removeHeader('x-scan-xsrf')

            // 报告等二进制下载避免代理层错误解码
            if (String(req.url || '').includes('/download')) {
              proxyReq.setHeader('Accept-Encoding', 'identity')
            }
          })
        },
      },
    },
  },
})
