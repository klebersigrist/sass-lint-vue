const walk = require('walk')
const fs = require('fs')
const yaml = require('js-yaml')
const path = require('path')
const htmlparser = require('htmlparser2')
const cheerio = require('cheerio')
const sassLint = require('sass-lint')
const Reporter = require('./reporter.js')

class Linter {
  constructor (options) {
    this.lintErrors = []
  }

  checkPaths (pathsToCheck) {
    pathsToCheck.forEach((pathToCheck) => {
      if (pathToCheck.substr(-3) === 'vue') {
        this.lintFile(pathToCheck, this.walkerEndHandler.bind(this))
      } else {
        this.checkPath(pathToCheck)
      }
    })
  }

  checkPath (arg) {
    const walker = walk.walk(arg, { followLinks: false })
    walker.on('file', this.walkerFileHandler.bind(this))
    walker.on('end', this.walkerEndHandler.bind(this))
    walker.on('errors', this.walkerErrorsHandler.bind(this))
  }

  walkerErrorsHandler (root, nodeStatsArray, next) {
    console.error('Linting Error: Invalid sass linting path.')
    console.log(nodeStatsArray)
    next()
  }

  walkerFileHandler (root, fileStat, next) {
    const filename = `${root}/${fileStat.name}`
    if (filename.substr(-3) !== 'vue') {
      return next()
    }
    this.lintFile(path.resolve(root, fileStat.name), next)
  }

  lintFile (filePath, next) {
    fs.readFile(filePath, (error, fileData) => {
      if (error) {
        return console.error(error)
      }

      const fileTemplates = this.extractFileTemplates(fileData)

      fileTemplates.forEach((template) => {
        const fileErrors = sassLint.lintText({
          text: template.content,
          filename: filePath,
          format: template.format
        })

        if (fileErrors.messages.length) {
          fileErrors.messages.forEach((message) => {
            message.line += template.lineOffset
          })
          this.lintErrors = this.lintErrors.concat(fileErrors)
        }
      })

      next()
    })
  }

  walkerEndHandler () {
    const reporter = new Reporter()
    reporter.report(this.lintErrors)
  }

  findFile (filename) {
    var HOME = process.env.HOME || process.env.HOMEPATH || process.env.USERPROFILE
    var dirname = null

    let configPath = path.join(process.cwd(), filename)

    if (configPath && fs.existsSync(configPath)) {
      return fs.realpathSync(configPath)
    }

    dirname = path.dirname(configPath)

    if (dirname === null || dirname === HOME) {
      return null
    }

    configPath = path.join(dirname, filename)

    return configPath
  }

  loadConfig () {
    let configPath
    let resolvedConfig = {}

    configPath = this.findFile('.sass-lint.yml')
    if (!configPath) {
      configPath = this.findFile('.sasslintrc')
    }

    if (configPath) {
      if (fs.existsSync(configPath)) {
        resolvedConfig = yaml.safeLoad(fs.readFileSync(configPath, 'utf8')) || {}
      }
    }

    return {
      options: resolvedConfig.options || {},
      files: resolvedConfig.files || {},
      rules: resolvedConfig.rules || {}
    }
  }

  getBaseIndent (config) {
    if (config.rules['indentation']) {
      const options = config.rules['indentation'][1]
      if (options) {
        return options['base-indent']
      }
    }
    return null
  }

  extractFileTemplates (fileData) {
    let templates = []

    const handler = new htmlparser.DefaultHandler((error, dom) => {
      if (error) {
        return console.log(error)
      }

      const $ = cheerio.load(dom)
      const scssTemplate = $('style[lang="scss"]')
      const sassTemplate = $('style[lang="sass"]')

      const config = this.loadConfig()
      const baseIndent = this.getBaseIndent(config)
      const regex = new RegExp(`^ {${baseIndent}}`, 'gm')

      if (scssTemplate && scssTemplate.length) {
        scssTemplate.each((index, el) => {
          const template = el.children[0].data
          templates.push({
            content: baseIndent ? template.replace(regex, '') : template,
            format: 'scss',
            lineOffset: this.getLineOffset(template, fileData.toString())
          })
        })
      }
      if (sassTemplate && sassTemplate.length) {
        sassTemplate.each((index, el) => {
          const template = el.children[0].data
          templates.push({
            content: baseIndent ? template.replace(regex, '') : template,
            format: 'sass',
            lineOffset: this.getLineOffset(template, fileData.toString())
          })
        })
      }
    })

    var parser = new htmlparser.Parser(handler)
    parser.parseComplete(fileData)
    return templates
  }

  getLineOffset (needle, haystack) {
    const targetPosition = haystack.indexOf(needle)
    const untilTargetPosition = haystack.substring(0, targetPosition)
    return untilTargetPosition.split(/\r?\n/).length - 1
  }
}

module.exports = Linter
