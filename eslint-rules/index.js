// eslint-rules/index.js
// shared ESLint comment-style rules plugin

import fileHeader from './file-header.js'
import noJsdocBlocks from './no-jsdoc-blocks.js'
import commentStyleGuide from './comment-style-guide.js'
import commentBlockLength from './comment-block-length.js'
import noUnicodeArrow from './no-unicode-arrow.js'

export default {
  rules: {
    'file-header': fileHeader,
    'no-jsdoc-blocks': noJsdocBlocks,
    'comment-style-guide': commentStyleGuide,
    'comment-block-length': commentBlockLength,
    'no-unicode-arrow': noUnicodeArrow,
  },
}
