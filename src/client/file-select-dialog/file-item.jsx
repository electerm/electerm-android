import FileIcon from '../electerm-react/components/sftp/file-icon'
import classNames from 'classnames'
export default function FileItem (props) {
  const {
    file,
    selected,
    onClick,
    onDbClick
  } = props
  const handleClick = (e) => {
    onClick(file, e)
  }
  const handleDbClick = () => {
    onDbClick(file)
  }
  const cls = classNames(
    'dialog-file-item elli',
    {
      selected
    }
  )
  return (
    <div
      className={cls}
      onClick={handleClick}
      onDoubleClick={handleDbClick}
    >
      <FileIcon
        file={props.file}
      />
      <span className='mg1l'>{file.name}</span>
    </div>
  )
}
