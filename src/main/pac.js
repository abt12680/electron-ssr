/**
 * pac文件下载更新等
 */
import http from 'http'
import httpShutdown from 'http-shutdown'
import { parse } from 'url'
import { readFile, writeFile, pathExists } from 'fs-extra'
import logger from './logger'
import { request } from '../shared/utils'
import bootstrapPromise, { pacPath } from './bootstrap'
import { currentConfig, appConfig$ } from './data'
import { isHostPortValid } from './port'
import { showNotificationInOne } from './notification'
let pacContent
let pacServer

httpShutdown.extend()

/**
 * 下载pac文件
 */
export async function downloadPac (force = false) {
  await bootstrapPromise
  const pacExisted = await pathExists(pacPath)
  if (force || !pacExisted) {
    logger.debug('start download pac')
    const pac = await request('https://softs.fun/Other/pac.txt')
    pacContent = pac
    return await writeFile(pacPath, pac)
  }
}

function readPac () {
  return new Promise(resolve => {
    if (!pacContent) {
      resolve(readFile(pacPath))
    } else {
      resolve(pacContent)
    }
  })
}

/**
 * pac server
 */
export async function serverPac (appConfig) {
  if (appConfig.configs && appConfig.configs[appConfig.index]) {
    const host = currentConfig.shareOverLan ? '0.0.0.0' : '127.0.0.1'
    const port = appConfig.pacPort !== undefined ? appConfig.pacPort : currentConfig.pacPort || 1240
    isHostPortValid(host, port).then(() => {
      pacServer = http.createServer((req, res) => {
        if (parse(req.url).pathname === '/proxy.pac') {
          downloadPac().then(() => {
            return readPac()
          }).then(buffer => buffer.toString()).then(text => {
            res.writeHead(200, {
              'Content-Type': 'application/x-ns-proxy-autoconfig',
              'Connection': 'close'
            })
            res.write(text.replace(/__PROXY__/g, `SOCKS5 127.0.0.1:${appConfig.localPort}; SOCKS 127.0.0.1:${appConfig.localPort}; PROXY 127.0.0.1:${appConfig.localPort}; ${appConfig.httpProxyEnable ? 'PROXY 127.0.0.1:' + appConfig.httpProxyPort + ';' : ''} DIRECT`))
            res.end()
          })
        } else {
          res.writeHead(200)
          res.end()
        }
      }).withShutdown().listen(port, host)
        .on('listening', () => {
          if (process.env.NODE_ENV === 'development') {
            console.log('pac server listen at: %s:%s', host, port)
          } else {
            logger.debug(`pac server listen at: ${host}:${port}`)
          }
        })
        .once('error', err => {
          if (process.env.NODE_ENV === 'development') {
            console.log('pac server error: ', err)
          } else {
            logger.debug(`pac server error: ${err}`)
          }
          pacServer.shutdown()
        })
    }).catch(() => {
      showNotificationInOne(`PAC端口 ${port} 被占用`, '警告')
    })
  }
}

/**
 * 关闭pac服务
 */
export async function stopPacServer () {
  if (pacServer && pacServer.listening) {
    return new Promise((resolve, reject) => {
      pacServer.shutdown(err => {
        if (err) {
          if (process.env.NODE_ENV === 'development') {
            console.log(err)
          } else {
            logger.warn(`close pac server error: ${err}`)
          }
          reject()
        } else {
          if (process.env.NODE_ENV === 'development') {
            console.log('pac server closed.')
          } else {
            logger.debug('pac server closed.')
          }
          resolve()
        }
      })
    })
  }
  return Promise.resolve()
}

// 监听配置变化
appConfig$.subscribe(data => {
  const [appConfig, changed] = data
  // 初始化
  if (changed.length === 0) {
    serverPac(appConfig)
  } else {
    if (changed.indexOf('pacPort') > -1) {
      stopPacServer().then(() => {
        serverPac(appConfig)
      })
    }
  }
})
