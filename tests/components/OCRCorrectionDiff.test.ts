// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import OCRCorrectionDiff from '~/components/OCRCorrectionDiff.vue'

it('shows deleted whitespace explicitly without marking or duplicating unchanged text', () => {
  const wrapper = mount(OCRCorrectionDiff, { props: {
    original: 'a [icon:wound] , you may take',
    corrected: 'a [icon:wound], you may take',
  } })
  expect(wrapper.get('del').text()).toBe('␠')
  expect(wrapper.find('ins').exists()).toBe(false)
  expect(wrapper.text()).toBe('a [icon:wound]␠, you may take')
  expect(wrapper.get('del').attributes('aria-label')).toContain('削除')
  wrapper.unmount()
})
