'use strict'

const assert = require('assert')
const fs = require('fs')
const https = require('https')
const koa = require('koa')
const passport = require('koa-passport')
const ClientCertStrategy = require('../').Strategy
const request = require('co-request')

const serverKey = fs.readFileSync('test/data/server-key.pem')
const serverCert = fs.readFileSync('test/data/server-crt.pem')
const clientKey = fs.readFileSync('test/data/client1-key.pem')
const clientCert = fs.readFileSync('test/data/client1-crt.pem')
const client2Key = fs.readFileSync('test/data/client2-key.pem')
const client2Cert = fs.readFileSync('test/data/client2-crt.pem')
const caCert = fs.readFileSync('test/data/ca-crt.pem')
const crl = fs.readFileSync('test/data/ca-crl.pem')

let server
function createServer (app) {
  const options = {
    port: 3000,
    key: serverKey,
    cert: serverCert,
    ca: caCert,
    crl: crl,
    requestCert: true,
    rejectUnauthorized: true
  }

  server = https.createServer(options, app.callback()).listen(3000)
}

describe('client-cert strategy', () => {
  it('should be named client-cert', () => {
    const strategy = new ClientCertStrategy(() => {})
    assert.strictEqual(strategy.name, 'client-cert')
  })

  it('should throw without verify callback', () => {
    assert.throws(() => new ClientCertStrategy())
  })
})

describe('middleware test', () => {
  afterEach((done) => {
    server.close(done)
  })

  describe('handling a request with valid client certificates', () => {
    const validRequestOptions = {
      hostname: 'localhost',
      url: 'https://localhost:3000',
      path: '/',
      method: 'GET',
      key: clientKey,
      cert: clientCert,
      ca: caCert
    }

    it('is successful', function * () {
      const app = koa()
      const userObj = {foo: 'bar'}

      passport.use(new ClientCertStrategy((fingerprint, info, done) => {
        assert.strictEqual(fingerprint,
          'E4:E6:3E:7B:1D:8B:AD:22:C5:46:35:71:62:F2:FC:D9:0A:9A:47:5E')
        assert.deepEqual(info, {
          subject: {
            C: 'US',
            ST: 'CA',
            L: 'San Francisco',
            O: 'Example Co',
            OU: 'techops',
            CN: 'client1',
            emailAddress: 'certs@example.com' },
          issuer: {
            C: 'US',
            ST: 'CA',
            L: 'San Francisco',
            O: 'Example Co',
            OU: 'techops',
            CN: 'ca',
            emailAddress: 'certs@example.com'
          }
        })
        return done(null, userObj)
      }))

      app.use(passport.initialize())
      app.use(passport.authenticate('client-cert', {session: false}))
      app.use(function * () {
        assert(this.isAuthenticated())
        assert.deepEqual(this.req.user, userObj)
        this.body = 'test'
      })
      createServer(app)

      const result = yield request.get(validRequestOptions)
      assert.strictEqual(result.statusCode, 200)
    })
  })

  describe('revoked client certificate', () => {
    const invalidRequestOptions = {
      hostname: 'localhost',
      url: 'https://localhost:3000',
      path: '/',
      method: 'GET',
      key: client2Key,
      cert: client2Cert,
      ca: caCert
    }

    it('is not successful', function * () {
      const app = koa()

      passport.use(new ClientCertStrategy((fingerprint, info, done) => {
        return done(null, fingerprint, info)
      }))

      app.use(passport.initialize())
      app.use(passport.authenticate('client-cert', {session: false}))
      app.use(function * () { this.body = 'test' })
      createServer(app)

      try {
        yield request.get(invalidRequestOptions)
        throw new Error('Request should not be successful')
      } catch (err) {
        assert.strictEqual(err.message, 'socket hang up')
        assert.strictEqual(err.code, 'ECONNRESET')
      }
    })
  })
})