import './index.scss';

let originalData: any = null;

// Tab switching
function initTabs() {
  $('.tab-btn').on('click', function () {
    const tabId = $(this).data('tab');

    // Update buttons
    $('.tab-btn').removeClass('active');
    $(this).addClass('active');

    // Update content
    $('.tab-content').removeClass('active');
    $(`#tab-${tabId}`).addClass('active');
  });
}

// Load variables
async function loadVariables() {
  await waitGlobalInitialized('Mvu');

  // Since we're in a sidebar, we use 'latest' instead of getCurrentMessageId()
  const mvu_data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
  const kinako = _.get(mvu_data, 'stat_data.kinako', {});

  originalData = _.cloneDeep(kinako);

  // Stats
  $('#affection').val(kinako.affection || 0);
  $('#affection-display').text(kinako.affection || 0);
  $('#energy_level').val(kinako.energy_level || 0);
  $('#energy_level-display').text(kinako.energy_level || 0);
  $('#mood').val(kinako.mood || '');
  $('#current_activity').val(kinako.current_activity || '');

  // Outfit
  $('#outfit_costume').val(_.get(kinako, 'outfit.costume', ''));
  $('#outfit_accessories').val(_.get(kinako, 'outfit.accessories', ''));

  // Favorites
  renderFavorites(kinako.favorite_things || {});
}

// Render favorites
function renderFavorites(favorites: any) {
  const container = $('#favorites-container');
  container.empty();

  for (const [name, data] of Object.entries(favorites)) {
    const interest_level = (data as any).interest_level || 0;
    const description = (data as any).description || '';
    const item = $(`
      <div class="favorite-item" data-name="${name}">
        <div class="favorite-header">
          <span class="favorite-name">${name}</span>
          <span class="favorite-stars">${interest_level}/10</span>
        </div>
        <div class="favorite-desc">${description}</div>
      </div>
    `);
    container.append(item);
  }
}

// Gather values
function gatherCurrentValues() {
  return {
    affection: parseInt($('#affection').val() as string),
    energy_level: parseInt($('#energy_level').val() as string),
    mood: $('#mood').val(),
    current_activity: $('#current_activity').val(),
    outfit: {
      costume: $('#outfit_costume').val(),
      accessories: $('#outfit_accessories').val(),
    },
    favorite_things: originalData?.favorite_things || {},
  };
}

// Save changes
async function saveChanges() {
  const $btn = $('#save-btn');
  const $status = $('#status-msg');

  try {
    $btn.prop('disabled', true).text('...');

    await waitGlobalInitialized('Mvu');

    const mvu_data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });
    const newKinako = gatherCurrentValues();

    _.set(mvu_data, 'stat_data.kinako', newKinako);
    await Mvu.replaceMvuData(mvu_data, { type: 'message', message_id: 'latest' });

    originalData = _.cloneDeep(newKinako);

    $status.removeClass('error').addClass('success').text('✓ Saved!');
    setTimeout(() => $status.removeClass('success'), 2000);
  } catch (error: any) {
    console.error('Save failed:', error);
    $status
      .removeClass('success')
      .addClass('error')
      .text('✗ ' + error.message);
  } finally {
    $btn.prop('disabled', false).text('💾 Save');
  }
}

// Add favorite
async function addFavorite() {
  const name = prompt('New favorite name:');
  if (!name || !name.trim()) return;

  const desc = prompt('Description:') || 'No description';
  const level = parseInt(prompt('Interest level (1-10):') || '5');

  try {
    await waitGlobalInitialized('Mvu');

    const mvu_data = Mvu.getMvuData({ type: 'message', message_id: 'latest' });

    _.set(mvu_data, `stat_data.kinako.favorite_things.${name.trim()}`, {
      description: desc,
      interest_level: Math.min(10, Math.max(1, level)),
    });

    await Mvu.replaceMvuData(mvu_data, { type: 'message', message_id: 'latest' });
    await loadVariables();

    $('#status-msg').removeClass('error').addClass('success').text('✓ Added!');
    setTimeout(() => $('#status-msg').removeClass('success'), 2000);
  } catch (error) {
    console.error('Add failed:', error);
  }
}

// Init events
function initEvents() {
  $('#affection').on('input', function () {
    $('#affection-display').text($(this).val() as string);
  });

  $('#energy_level').on('input', function () {
    $('#energy_level-display').text($(this).val() as string);
  });

  $('#save-btn').on('click', saveChanges);
  $('#add-fav-btn').on('click', addFavorite);
}

// Main
async function init() {
  initTabs();
  await loadVariables();
  initEvents();
}

$(errorCatched(init));
