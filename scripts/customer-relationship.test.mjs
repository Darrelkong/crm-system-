import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { relationshipFixture } from './fixtures/customer-relationship.mjs';

describe('R1 real customer page / API / SQL relationship boundary', () => {
  let fixture;
  before(async () => { fixture = await relationshipFixture(); });
  after(() => fixture?.close());
  const ids = rows => rows.map(c => c.id);
  const forbidden = ['private-001','private-002','private-003','archived','pool','pending'];
  for (const [relationship,total,prefix] of [[undefined,88,null],['owner',45,'owned-'],['collaborator',43,'collab-']]) {
    const name = relationship ?? 'all';
    it(`direct page ${name}: correct permitted rows, total and selected tab`, async () => {
      const {props} = await fixture.page({relationship});
      assert.equal(props.pagination.total,total);
      assert.equal(props.filterRelationship,relationship);
      assert.equal(props.initialRows.length,40);
      if(prefix)assert.ok(ids(props.initialRows).every(id=>id.startsWith(prefix)));
      assert.ok(ids(props.initialRows).every(id=>!forbidden.includes(id)));
    });
    it(`API ${name}: page 2 and search retain relationship and privacy boundary`, async () => {
      const query=new URLSearchParams({page:'2',q:'needle'});
      if(relationship)query.set('relationship',relationship);
      const result=await fixture.api(query.toString());
      assert.equal(result.total,total);assert.equal(result.page,2);
      assert.equal(result.items.length,Math.min(40,total-40));
      if(prefix)assert.ok(ids(result.items).every(id=>id.startsWith(prefix)));
      assert.ok(ids(result.items).every(id=>!forbidden.includes(id)));
      const page=await fixture.page({relationship,page:'2'});
      assert.deepEqual(ids(page.props.initialRows),ids(result.items));
    });
  }
  it('owner-only and collaborator-only records cannot cross through search', async () => {
    assert.equal((await fixture.api('relationship=owner&q=collab')).total,0);
    assert.equal((await fixture.api('relationship=collaborator&q=owned')).total,0);
    assert.equal((await fixture.api('relationship=collaborator&q=owned-001')).total,0);
  });
  it('each relationship remains inside normal Team Member authorization', async () => {
    for(const relationship of ['', 'owner', 'collaborator']) {
      for(const q of forbidden) {
        const result=await fixture.api(new URLSearchParams({relationship,q,ownerId:'other',status:'archived'}).toString());
        assert.equal(result.total,0,`${relationship}: ${q} must stay hidden`);
      }
    }
  });
  it('invalid relationship values retain existing normal-scope fallback', async () => {
    for(const relationship of ['invalid','OWNER',"owner' OR 1=1 --"]) {
      assert.equal((await fixture.page({relationship})).props.pagination.total,88);
      assert.equal((await fixture.api(new URLSearchParams({relationship}).toString())).total,88);
    }
  });
  it('Admin ignores staff relationship filters, retaining active and archived semantics', async () => {
    const expected=await fixture.page({},'admin');
    for(const relationship of ['owner','collaborator','invalid']) {
      const page=await fixture.page({relationship},'admin');
      assert.deepEqual(page.props.initialRows,expected.props.initialRows);
      assert.equal(page.props.pagination.total,91);
      assert.equal(page.key,expected.key);
      assert.equal((await fixture.api(`relationship=${relationship}`,'admin')).total,91);
      const archived=await fixture.api(`status=archived&relationship=${relationship}`,'admin');
      assert.deepEqual(ids(archived.items),['archived']);
    }
  });
  it('relationship changes reset the real client boundary; page-only changes do not', async () => {
    const all=await fixture.page({});const owner=await fixture.page({relationship:'owner'});
    const collaborator=await fixture.page({relationship:'collaborator'});
    assert.notEqual(owner.key,collaborator.key);assert.notEqual(all.key,owner.key);
    assert.equal((await fixture.page({relationship:'owner',page:'2'})).key,owner.key);
    assert.equal((await fixture.page({relationship:'invalid'})).key,all.key);
  });
});

it('negative control: original page omission ignores both relationship tabs', async () => {
  const baseline=await relationshipFixture({pageTransform:source=>source.replace(
    '      relationship: params.relationship,\n    }),', '    }),',
  )});
  try {
    for(const relationship of ['owner','collaborator']) {
      const {props}=await baseline.page({relationship});
      assert.equal(props.pagination.total,88);
      assert.equal(props.filterRelationship,relationship);
    }
  } finally {baseline.close();}
});
