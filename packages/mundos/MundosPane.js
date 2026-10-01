import { css } from '@firebolt-dev/css'
import { useEffect, useState } from 'react'
import { Pane } from '@hyperfy/client/components/Sidebar'
import { FieldBtn, FieldToggle } from '@hyperfy/client/components/Fields'

export function MundosPane({ world, hidden }) {
  const { url, world: name, guest } = world.mundos
  const player = world.entities.player
  const isAdmin = player.isAdmin()
  const [freeBuild, setFreeBuild] = useState(false)
  useEffect(() => {
    if (!isAdmin) return
    fetch(`${world.network.apiUrl}/mundos`)
      .then(resp => resp.json())
      .then(data => setFreeBuild(!!data.freeBuild))
      .catch(err => console.error(err))
  }, [isAdmin])
  const toggleFreeBuild = value => {
    world.network.send('command', { args: ['freebuild', value ? 'on' : 'off'] })
    setFreeBuild(value)
  }
  const enter = `${url}/enter?host=${encodeURIComponent(location.host)}`
  return (
    <Pane hidden={hidden}>
      <div
        className='mundos'
        css={css`
          background: rgba(11, 10, 21, 0.9);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 1.375rem;
          display: flex;
          flex-direction: column;
          .mundos-head {
            height: 3.125rem;
            padding: 0 1rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            display: flex;
            align-items: center;
            font-weight: 500;
          }
          .mundos-content {
            padding: 0.5rem 0;
          }
          .mundos-note {
            padding: 0.5rem 1rem;
            color: rgba(255, 255, 255, 0.6);
            font-size: 0.9375rem;
          }
        `}
      >
        <div className='mundos-head'>Mundos</div>
        <div className='mundos-content'>
          {guest ? (
            <>
              <div className='mundos-note'>You are visiting as a guest.</div>
              <FieldBtn
                label='Sign in'
                hint='Sign in with your mundos account. You come back here signed in.'
                nav
                onClick={() => location.assign(enter)}
              />
            </>
          ) : (
            <>
              <div className='mundos-note'>Signed in as {player.data.name}.</div>
              {isAdmin && (
                <>
                  <FieldToggle
                    label='Free Build for accounts'
                    hint='Everyone with a mundos account can build here. Guests never can.'
                    trueLabel='On'
                    falseLabel='Off'
                    value={freeBuild}
                    onChange={toggleFreeBuild}
                  />
                  <FieldBtn
                    label='Open in mundos'
                    hint='This world in mundos: members, versions and addresses.'
                    nav
                    onClick={() => window.open(`${url}/worlds/${name}`, '_blank')}
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Pane>
  )
}
